// Runtime: PermissionGuard + default config (forwards constants from @agentnova/contracts)
export {
  PermissionGuard,
  DEFAULT_PERMISSION_CONFIG,
  DEFAULT_SANDBOX,
  DEFAULT_LIMITS,
  LEVEL_DEFAULT_MODE,
} from './guard.js'

// Types: forwarded from @agentnova/contracts so legacy imports keep working.
export type {
  PermissionLevel,
  ToolPermission,
  ApprovalRequest,
  ApprovalResult,
  ApprovalFn,
  PermissionMode,
  PermissionRule,
  PermissionConfig,
  SandboxConfig,
  ResourceLimits,
  ToolPreflight,
  ToolPreflightCtx,
  PreflightResult,
} from '@agentnova/contracts'
