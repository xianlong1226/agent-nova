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

  constructor(config: PermissionConfig) {
    this.rules = config.rules
    this.defaultMode = config.mode
    this.approvalFn = config.onApprovalNeeded
  }

  getEffectiveMode(toolName: string, toolLevel: PermissionLevel): PermissionMode {
    // 1. Explicit rules take highest priority
    for (const rule of this.rules) {
      if (this.matchToolPattern(rule.tool, toolName)) {
        return rule.mode
      }
    }
    // 2. If global mode is explicitly 'allow' or 'deny', use it as fallback
    if (this.defaultMode === 'allow' || this.defaultMode === 'deny') {
      return this.defaultMode
    }
    // 3. For 'ask' mode, use level-based defaults
    return LEVEL_DEFAULT_MODE[toolLevel] ?? 'ask'
  }

  async check(request: ApprovalRequest): Promise<ApprovalResult> {
    const mode = this.getEffectiveMode(request.tool, request.permission.level)

    switch (mode) {
      case 'allow':
        return 'allow-once'
      case 'deny':
        return 'deny'
      case 'ask': {
        if (!this.approvalFn) return 'deny'
        return this.approvalFn(request)
      }
    }
  }

  private matchToolPattern(pattern: string, toolName: string): boolean {
    if (pattern === '*') return true
    if (pattern === toolName) return true
    if (pattern.endsWith('.*')) {
      const namespace = pattern.slice(0, -2)
      return toolName.startsWith(namespace + '.')
    }
    return false
  }
}
