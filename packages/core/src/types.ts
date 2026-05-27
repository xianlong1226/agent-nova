import type { ToolDefinition, ToolCall, ToolResult, ToolContext, AgentStateSnapshot, ToolLogger } from '@agentnova/tools'
import type { PermissionGuard, PermissionConfig, ResourceLimits } from '@agentnova/permission'
import type { ProviderRouter, ProviderConfig } from '@agentnova/providers'
import type { CoreMessage } from 'ai'

// ─── Agent Events ──────────────────────────────────────────────────

export type AgentEventName =
  | 'agent:start'
  | 'agent:end'
  | 'agent:error'
  | 'llm:call'
  | 'llm:response'
  | 'tool:call'
  | 'tool:result'
  | 'tool:approved'
  | 'tool:denied'
  | 'context:compressed'
  | 'memory:stored'
  | 'memory:retrieved'
  | 'skill:activated'
  | 'skill:deactivated'
  | 'provider:fallback'
  | 'step'

export interface AgentEvent {
  type: AgentEventName
  timestamp: number
  data: Record<string, unknown>
}

export type EventHandler = (event: AgentEvent) => void

// ─── Lifecycle Hooks ───────────────────────────────────────────────

export type HookName =
  | 'onStart'
  | 'onBeforeLLMCall'
  | 'onAfterLLMCall'
  | 'onBeforeToolCall'
  | 'onAfterToolCall'
  | 'onEnd'
  | 'onError'

export interface HookContext {
  agentState: AgentState
  step: number
  messages?: CoreMessage[]
  toolCall?: ToolCall
  toolResult?: ToolResult
  // Hook can modify these to alter behavior
  modified?: boolean
}

export type HookFn = (ctx: HookContext) => Promise<void | { action?: 'deny'; reason?: string }>

// ─── Context Config ────────────────────────────────────────────────

export type CompressionStrategy = 'summary' | 'sliding-window' | 'hybrid'

export interface ContextConfig {
  /** Number of recent turns to preserve without compression */
  preserveRecentTurns: number
  /** Token threshold to trigger compression (fraction of contextWindow) */
  compressionTriggerRatio: number
  /** Compression strategy */
  compressionStrategy: CompressionStrategy
  /** Max tool output length before truncation */
  maxToolOutputLength: number
  /** Truncation strategy for tool output */
  toolOutputTruncate: 'tail' | 'head'
  /** Per-provider context window overrides */
  contextWindowOverrides?: Record<string, number>
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  preserveRecentTurns: 10,
  compressionTriggerRatio: 0.7,
  compressionStrategy: 'hybrid',
  maxToolOutputLength: 8_000,
  toolOutputTruncate: 'tail',
}

// ─── Agent State ───────────────────────────────────────────────────

export interface AgentState {
  step: number
  totalTokensUsed: number
  totalCost: number
  startTime: number
  toolCallCount: number
  aborted: boolean
  messages: CoreMessage[]
}

// ─── Agent Config ──────────────────────────────────────────────────

export interface AgentConfig {
  /** System prompt / identity */
  systemPrompt: string
  /** Working directory for file operations */
  workingDir: string
  /** Provider router */
  router: ProviderRouter
  /** Tools to register */
  tools: ToolDefinition[]
  /** Permission configuration */
  permissions?: Partial<PermissionConfig>
  /** Context management configuration */
  context?: Partial<ContextConfig>
  /** Custom model for this agent (overrides router default) */
  model?: string
}

// ─── Agent Run Options ─────────────────────────────────────────────

export interface AgentRunOptions {
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Callback for each step */
  onStep?: (step: StepInfo) => void
  /** Streaming callback for text output */
  onText?: (text: string) => void
  /** Max steps override for this run */
  maxSteps?: number
}

export interface StepInfo {
  step: number
  text?: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  tokensUsed?: { input: number; output: number }
  durationMs: number
}

// ─── Agent Result ──────────────────────────────────────────────────

export interface AgentResult {
  text: string
  messages: CoreMessage[]
  state: AgentState
  steps: StepInfo[]
  totalDurationMs: number
}
