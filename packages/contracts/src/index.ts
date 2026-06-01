// @agentnova/contracts — shared type contracts (no runtime dependencies)
// Single source of truth for permission/tools/sandbox/limits types and defaults.

// ─── Permission Types ──────────────────────────────────────────────

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

// ─── Permission Modes / Rules ──────────────────────────────────────

export type PermissionMode = 'allow' | 'ask' | 'deny'

export interface PermissionRule {
  tool: string
  mode: PermissionMode
  scope?: string[]
}

// ─── Sandbox / Limits ──────────────────────────────────────────────

export interface SandboxConfig {
  cwd?: string
  allowedDirs?: string[]
  blockedCommands?: string[]
  blockedCommandPatterns?: string[]
  maxFileSize?: number
  maxOutputLength?: number
  /** Allowed domains for web.search results; undefined/empty means no restriction */
  allowedSearchDomains?: string[]
}

export interface ResourceLimits {
  maxSteps: number
  maxTokens: number
  maxToolCalls: number
  timeoutMs: number
  maxFileSize: number
}

// ─── Permission Config ─────────────────────────────────────────────

export interface PermissionConfig {
  mode: PermissionMode
  rules: PermissionRule[]
  onApprovalNeeded?: ApprovalFn
  sandbox?: SandboxConfig
  limits: ResourceLimits
}

// ─── Tool Preflight (sandbox check carried by the tool itself) ─────

export type PreflightResult = { ok: true } | { ok: false; reason: string }

export interface ToolPreflightCtx {
  sandbox: SandboxConfig
}

export type ToolPreflight = (req: ApprovalRequest, ctx: ToolPreflightCtx) => PreflightResult

// ─── Defaults ──────────────────────────────────────────────────────

export const DEFAULT_LIMITS: ResourceLimits = {
  maxSteps: 50,
  maxTokens: 200_000,
  maxToolCalls: 100,
  timeoutMs: 300_000,
  maxFileSize: 10 * 1024 * 1024,
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

/** Default permission level → mode mapping (used as fallback when global mode is 'ask'). */
export const LEVEL_DEFAULT_MODE: Record<PermissionLevel, PermissionMode> = {
  read: 'allow',
  write: 'ask',
  dangerous: 'ask',
}
