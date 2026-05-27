// ─── Core ──────────────────────────────────────────────────────────
export { Agent, createAgent } from './agent.js'

// ─── Context ───────────────────────────────────────────────────────
export { ContextManager, DEFAULT_CONTEXT_CONFIG } from './context.js'

// ─── Types ─────────────────────────────────────────────────────────
export type {
  AgentConfig,
  AgentRunOptions,
  AgentResult,
  AgentState,
  StepInfo,
  AgentEvent,
  AgentEventName,
  EventHandler,
  HookName,
  HookFn,
  HookContext,
  ContextConfig,
  CompressionStrategy,
} from './types.js'
