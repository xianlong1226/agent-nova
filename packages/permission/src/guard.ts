// ─── Permission Types (self-contained, no cross-package deps) ──────

export type PermissionLevel = 'read' | 'write' | 'dangerous'

export interface ToolPermission {
  level: PermissionLevel
  scope?: string[]
  description?: string
}

export interface ApprovalRequest {
  tool: string
  args: Record<string, unknown>
  permission: ToolPermission
  reason?: string
}

export type ApprovalResult = 'allow-once' | 'allow-always' | 'deny'

export type ApprovalFn = (request: ApprovalRequest) => Promise<ApprovalResult>

// ─── Permission Modes ──────────────────────────────────────────────

export type PermissionMode = 'allow' | 'ask' | 'deny'

// ─── Permission Rules ──────────────────────────────────────────────

export interface PermissionRule {
  tool: string
  mode: PermissionMode
  scope?: string[]
}

// ─── Sandbox Config ────────────────────────────────────────────────

export interface SandboxConfig {
  cwd?: string
  allowedDirs?: string[]
  blockedCommands?: string[]
  blockedCommandPatterns?: string[]
  maxFileSize?: number
  maxOutputLength?: number
}

// ─── Resource Limits ───────────────────────────────────────────────

export interface ResourceLimits {
  maxSteps: number
  maxTokens: number
  maxToolCalls: number
  timeoutMs: number
  maxFileSize: number
}

export const DEFAULT_LIMITS: ResourceLimits = {
  maxSteps: 50,
  maxTokens: 200_000,
  maxToolCalls: 100,
  timeoutMs: 300_000,
  maxFileSize: 10 * 1024 * 1024,
}

// ─── Permission Config ─────────────────────────────────────────────

export interface PermissionConfig {
  mode: PermissionMode
  rules: PermissionRule[]
  onApprovalNeeded?: ApprovalFn
  sandbox?: SandboxConfig
  limits: ResourceLimits
}

export const DEFAULT_SANDBOX: SandboxConfig = {
  blockedCommands: ['rm -rf /', 'mkfs', 'dd if=', ':(){ :|:& };:'],
  blockedCommandPatterns: [
    'rm\\s+-[rR].*\\s+/',
    '>?/dev/sd',
    'chmod\\s+[0-7]*777\\s+/',
    'curl\\s+.*\\|\\s*sh',
    'wget\\s+.*\\|\\s*sh',
  ],
  maxFileSize: 10 * 1024 * 1024,
  maxOutputLength: 100_000,
}

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  mode: 'ask',
  rules: [
    { tool: 'fs.readFile', mode: 'allow' },
    { tool: 'fs.listDir', mode: 'allow' },
    { tool: 'fs.stat', mode: 'allow' },
    { tool: 'web.fetch', mode: 'allow' },
    { tool: 'web.search', mode: 'allow' },
    { tool: 'fs.writeFile', mode: 'ask' },
    { tool: 'shell.exec', mode: 'ask' },
  ],
  sandbox: DEFAULT_SANDBOX,
  limits: DEFAULT_LIMITS,
}

// ─── Default permission level → mode mapping ──────────────────────

const LEVEL_DEFAULT_MODE: Record<PermissionLevel, PermissionMode> = {
  read: 'allow',
  write: 'ask',
  dangerous: 'ask',
}

// ─── Permission Guard ──────────────────────────────────────────────

export class PermissionGuard {
  private rules: PermissionRule[]
  private defaultMode: PermissionMode
  private approvalFn: ApprovalFn | undefined
  private sandbox: SandboxConfig
  private alwaysAllowed: Map<string, Set<string>> = new Map()

  constructor(config: PermissionConfig) {
    this.rules = config.rules
    this.defaultMode = config.mode
    this.approvalFn = config.onApprovalNeeded
    this.sandbox = config.sandbox ?? DEFAULT_SANDBOX
  }

  getEffectiveMode(toolName: string, toolLevel: PermissionLevel): PermissionMode {
    // 1. Always-allowed cache overrides everything (user explicitly said always)
    const alwaysScopes = this.alwaysAllowed.get(toolName)
    if (alwaysScopes && alwaysScopes.has('*')) {
      return 'allow'
    }
    // 2. Explicit rules
    for (const rule of this.rules) {
      if (this.matchToolPattern(rule.tool, toolName)) {
        return rule.mode
      }
    }
    // 3. If global mode is explicitly 'allow' or 'deny', use it as fallback
    if (this.defaultMode === 'allow' || this.defaultMode === 'deny') {
      return this.defaultMode
    }
    // 4. For 'ask' mode, use level-based defaults
    return LEVEL_DEFAULT_MODE[toolLevel] ?? 'ask'
  }

  async check(request: ApprovalRequest): Promise<ApprovalResult> {
    // ── Sandbox pre-checks ──

    // 1. Path validation for fs tools
    if (request.tool.startsWith('fs.') && this.isPathBlocked(request)) {
      return 'deny'
    }

    // 2. Command blocking for shell tools
    if (request.tool === 'shell.exec' && this.isCommandBlocked(request)) {
      return 'deny'
    }

    // 3. File size check for write operations
    if (request.tool === 'fs.writeFile' && this.isFileSizeExceeded(request)) {
      return 'deny'
    }

    // ── Permission mode check ──
    const mode = this.getEffectiveMode(request.tool, request.permission.level)

    switch (mode) {
      case 'allow':
        return 'allow-once'
      case 'deny':
        return 'deny'
      case 'ask': {
        if (!this.approvalFn) return 'deny'
        const result = await this.approvalFn(request)
        if (result === 'allow-always') {
          this.rememberAllowAlways(request)
        }
        return result
      }
    }
  }

  /** Validate file path against sandbox allowedDirs */
  private isPathBlocked(request: ApprovalRequest): boolean {
    const path = request.args.path as string | undefined
    if (!path) return false

    const allowedDirs = this.sandbox.allowedDirs
    if (!allowedDirs || allowedDirs.length === 0) return false

    const resolvedPath = this.resolvePath(path)
    const isAllowed = allowedDirs.some(dir => resolvedPath.startsWith(this.resolvePath(dir)))
    return !isAllowed
  }

  /** Check command against blocked list and patterns */
  private isCommandBlocked(request: ApprovalRequest): boolean {
    const command = request.args.command as string | undefined
    if (!command) return false

    // Exact match blocked commands
    const blockedCommands = this.sandbox.blockedCommands ?? []
    if (blockedCommands.some(blocked => command.includes(blocked))) {
      return true
    }

    // Regex pattern match
    const patterns = this.sandbox.blockedCommandPatterns ?? []
    if (patterns.some(pattern => {
      try {
        return new RegExp(pattern, 'i').test(command)
      } catch {
        return false
      }
    })) {
      return true
    }

    return false
  }

  /** Check if file write exceeds maxFileSize */
  private isFileSizeExceeded(request: ApprovalRequest): boolean {
    const content = request.args.content as string | undefined
    if (!content) return false
    const maxSize = this.sandbox.maxFileSize ?? DEFAULT_LIMITS.maxFileSize
    return Buffer.byteLength(content, 'utf-8') > maxSize
  }

  /** Remember an allow-always decision */
  private rememberAllowAlways(request: ApprovalRequest): void {
    const scopes = this.alwaysAllowed.get(request.tool)
    if (scopes) {
      scopes.add('*')
    } else {
      this.alwaysAllowed.set(request.tool, new Set(['*']))
    }
  }

  /** Resolve path relative to sandbox cwd */
  private resolvePath(p: string): string {
    if (this.sandbox.cwd && !p.startsWith('/')) {
      return `${this.sandbox.cwd}/${p}`.replace(/\/+/g, '/')
    }
    return p
  }

  /** Match tool name against pattern (supports * and namespace.*) */
  private matchToolPattern(pattern: string, toolName: string): boolean {
    if (pattern === '*') return true
    if (pattern === toolName) return true
    if (pattern.endsWith('.*')) {
      const namespace = pattern.slice(0, -2)
      return toolName.startsWith(namespace + '.')
    }
    return false
  }

  /** Reset always-allowed cache */
  resetAllowAlways(): void {
    this.alwaysAllowed.clear()
  }

  /** Get current sandbox config (read-only) */
  getSandbox(): Readonly<SandboxConfig> {
    return { ...this.sandbox }
  }
}
