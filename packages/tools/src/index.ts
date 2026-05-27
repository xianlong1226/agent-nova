// ─── Types ─────────────────────────────────────────────────────────
export type {
  PermissionLevel,
  ToolPermission,
  ToolContext,
  ToolDefinition,
  ToolCall,
  ToolResult,
  ApprovalFn,
  ApprovalRequest,
  ApprovalResult,
  AgentStateSnapshot,
  ToolLogger,
} from './types.js'
export { defineTool } from './types.js'

// ─── Registry & Engine ─────────────────────────────────────────────
export { ToolRegistry, ToolEngine } from './registry.js'

// ─── Built-in Tools ────────────────────────────────────────────────
export { fsTools, readFile, writeFile, listDir, fsStat } from './builtin/fs.js'
export { shellTools, shellExec } from './builtin/shell.js'
