import type { PermissionLevel, ApprovalRequest, ApprovalResult, ApprovalFn } from '@agentnova/tools'

// ─── Permission Modes ──────────────────────────────────────────────

export type PermissionMode = 'allow' | 'ask' | 'deny'

// ─── Permission Rules ──────────────────────────────────────────────

export interface PermissionRule {
  /** Tool name or pattern (e.g. 'fs.writeFile', 'shell.exec', '*' ) */
  tool: string
  /** Override mode for this rule */
  mode: PermissionMode
  /** Optional scope restrictions (glob patterns, command patterns, etc.) */
  scope?: string[]
}

// ─── Sandbox Config ────────────────────────────────────────────────

export interface SandboxConfig {
  /** Restrict working directory */
  cwd?: string
  /** Allow read/write only within these directories */
  allowedDirs?: string[]
  /** Block these shell command patterns */
  blockedCommands?: string[]
  /** Max file size in bytes */
  maxFileSize?: number
  /** Max command output length */
  maxOutputLength?: number
}

// ─── Resource Limits ───────────────────────────────────────────────

export interface ResourceLimits {
  /** Max agent loop steps */
  maxSteps: number
  /** Max total tokens consumed */
  maxTokens: number
  /** Max tool calls per run */
  maxToolCalls: number
  /** Overall timeout in ms */
  timeoutMs: number
  /** Max file size in bytes for fs operations */
  maxFileSize: number
}

export const DEFAULT_LIMITS: ResourceLimits = {
  maxSteps: 50,
  maxTokens: 200_000,
  maxToolCalls: 100,
  timeoutMs: 300_000,
  maxFileSize: 10 * 1024 * 1024, // 10MB
}

// ─── Permission Config ─────────────────────────────────────────────

export interface PermissionConfig {
  /** Global default mode */
  mode: PermissionMode
  /** Fine-grained rules (evaluated in order, first match wins) */
  rules: PermissionRule[]
  /** Human approval callback */
  onApprovalNeeded?: ApprovalFn
  /** Sandbox restrictions */
  sandbox?: SandboxConfig
  /** Resource limits */
  limits: ResourceLimits
}

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  mode: 'ask',
  rules: [
    // Read operations are safe by default
    { tool: 'fs.readFile', mode: 'allow' },
    { tool: 'fs.listDir', mode: 'allow' },
    { tool: 'fs.stat', mode: 'allow' },
    // Web reads are safe
    { tool: 'web.fetch', mode: 'allow' },
    { tool: 'web.search', mode: 'allow' },
    // Write operations need approval
    { tool: 'fs.writeFile', mode: 'ask' },
    // Shell is dangerous
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

  /**
   * Check if a tool call is allowed, needs approval, or denied.
   * Returns the effective mode after evaluating rules.
   */
  getEffectiveMode(toolName: string, toolLevel: PermissionLevel): PermissionMode {
    // 1. Check explicit rules (first match wins)
    for (const rule of this.rules) {
      if (this.matchToolPattern(rule.tool, toolName)) {
        return rule.mode
      }
    }

    // 2. Fall back to level-based defaults
    return LEVEL_DEFAULT_MODE[toolLevel] ?? this.defaultMode
  }

  /**
   * Full permission check: returns approval result.
   * Call this before executing any tool.
   */
  async check(request: ApprovalRequest): Promise<ApprovalResult> {
    const mode = this.getEffectiveMode(request.tool, request.permission.level)

    switch (mode) {
      case 'allow':
        return 'allow-once'

      case 'deny':
        return 'deny'

      case 'ask': {
        if (!this.approvalFn) {
          // No approval handler → deny by default
          return 'deny'
        }
        return this.approvalFn(request)
      }
    }
  }

  /** Simple glob-like pattern matching for tool names */
  private matchToolPattern(pattern: string, toolName: string): boolean {
    if (pattern === '*') return true
    if (pattern === toolName) return true
    // Wildcard namespace: 'fs.*' matches 'fs.readFile', 'fs.writeFile'
    if (pattern.endsWith('.*')) {
      const namespace = pattern.slice(0, -2)
      return toolName.startsWith(namespace + '.')
    }
    return false
  }
}
