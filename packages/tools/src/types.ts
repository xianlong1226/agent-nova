import { z } from 'zod'

// ─── Permission Levels ─────────────────────────────────────────────

export type PermissionLevel = 'read' | 'write' | 'dangerous'

export interface ToolPermission {
  /** Permission level of this tool */
  level: PermissionLevel
  /** Optional scope restrictions (e.g. path patterns, command patterns) */
  scope?: string[]
  /** Human-readable description of what this permission entails */
  description?: string
}

// ─── Tool Context ──────────────────────────────────────────────────

export type ApprovalResult = 'allow-once' | 'allow-always' | 'deny'

export interface ApprovalRequest {
  tool: string
  args: Record<string, unknown>
  permission: ToolPermission
  reason?: string
}

export type ApprovalFn = (request: ApprovalRequest) => Promise<ApprovalResult>

export interface ToolContext {
  /** Current agent state (read-only snapshot) */
  agentState: Readonly<AgentStateSnapshot>
  /** Working directory for this agent */
  workingDir: string
  /** Abort signal for cancellation */
  abortSignal: AbortSignal
  /** Request human approval for this tool call */
  askApproval: ApprovalFn
  /** Structured logger */
  logger: ToolLogger
}

export interface AgentStateSnapshot {
  step: number
  totalTokensUsed: number
  startTime: number
}

export interface ToolLogger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

// ─── Tool Definition ───────────────────────────────────────────────

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Unique tool name, namespaced with dot notation (e.g. 'fs.readFile') */
  name: string
  /** Description for the LLM to understand when to use this tool */
  description: string
  /** Zod schema for input validation */
  parameters: z.ZodType<TInput>
  /** Permission declaration */
  permission: ToolPermission
  /** Execute the tool */
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>
}

// ─── Tool Call / Result ────────────────────────────────────────────

export interface ToolCall {
  tool: string
  args: Record<string, unknown>
}

export interface ToolResult {
  tool: string
  output: unknown
  error?: string
  durationMs: number
  approved: boolean
}

// ─── Helper: defineTool ────────────────────────────────────────────

export function defineTool<TInput, TOutput>(
  def: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return def
}
