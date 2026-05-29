import {
  DEFAULT_LIMITS,
  DEFAULT_SANDBOX,
  LEVEL_DEFAULT_MODE,
  type ApprovalFn,
  type ApprovalRequest,
  type ApprovalResult,
  type PermissionConfig,
  type PermissionLevel,
  type PermissionMode,
  type PermissionRule,
  type SandboxConfig,
  type ToolPreflight,
} from '@agentnova/contracts'

// Re-export shared contract types so existing callers keep working unchanged.
export {
  DEFAULT_LIMITS,
  DEFAULT_SANDBOX,
  LEVEL_DEFAULT_MODE,
}
export type {
  ApprovalFn,
  ApprovalRequest,
  ApprovalResult,
  PermissionConfig,
  PermissionLevel,
  PermissionMode,
  PermissionRule,
  SandboxConfig,
  ToolPreflight,
}

// ─── Default Permission Config ─────────────────────────────────────

/**
 * Default permission config. Rules are intentionally empty:
 * mode resolution falls back to per-tool `permission.level` via LEVEL_DEFAULT_MODE,
 * so adding/renaming a built-in tool no longer requires editing this list.
 */
export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  mode: 'ask',
  rules: [],
  sandbox: DEFAULT_SANDBOX,
  limits: DEFAULT_LIMITS,
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
      if (PermissionGuard.matchToolPattern(rule.tool, toolName)) {
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

  /**
   * Check whether a tool call is permitted.
   *
   * @param request - the approval request
   * @param preflight - optional sandbox preflight provided by the tool itself.
   *   When provided, it runs before the mode check; a `{ ok: false }` result short-circuits to 'deny'.
   *   This replaces the previous hard-coded `fs.*` / `shell.exec` handling that lived inside the guard.
   */
  async check(request: ApprovalRequest, preflight?: ToolPreflight): Promise<ApprovalResult> {
    // ── Tool-supplied sandbox preflight ──
    if (preflight) {
      const result = preflight(request, { sandbox: this.sandbox })
      if (!result.ok) return 'deny'
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

  /** Remember an allow-always decision */
  private rememberAllowAlways(request: ApprovalRequest): void {
    const scopes = this.alwaysAllowed.get(request.tool)
    if (scopes) {
      scopes.add('*')
    } else {
      this.alwaysAllowed.set(request.tool, new Set(['*']))
    }
  }

  /** Match tool name against pattern (supports * and namespace.*) */
  static matchToolPattern(pattern: string, toolName: string): boolean {
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
