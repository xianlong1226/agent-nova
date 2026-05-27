import { z } from 'zod'

// ─── Self-contained types (no cross-package deps for zero-coupling) ─

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

// ─── Tool Context ──────────────────────────────────────────────────

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

export interface ToolContext {
  agentState: Readonly<AgentStateSnapshot>
  workingDir: string
  abortSignal: AbortSignal
  askApproval: ApprovalFn
  logger: ToolLogger
}

// ─── Tool Definition ───────────────────────────────────────────────

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string
  description: string
  parameters: z.ZodTypeAny
  permission: ToolPermission
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

// ─── Helper ────────────────────────────────────────────────────────

export function defineTool<TInput = any, TOutput = any>(
  def: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return def
}
