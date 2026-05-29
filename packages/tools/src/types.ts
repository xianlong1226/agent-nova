import { z } from 'zod'
import type { ToolPermission, ApprovalFn, ToolPreflight } from '@agentnova/contracts'

// Forward ALL shared contract types so tool authors can import everything from '@agentnova/tools'.
// Using wildcard re-export keeps this list auto-synced with @agentnova/contracts — no manual drift.
export type * from '@agentnova/contracts'

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
  /**
   * Optional sandbox preflight carried by the tool itself.
   * Invoked by PermissionGuard before mode resolution; returning `{ ok: false }` denies the call.
   */
  preflight?: ToolPreflight
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
