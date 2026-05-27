// ─── Core ──────────────────────────────────────────────────────────
export { Agent, createAgent } from './agent.js'

// ─── Context ───────────────────────────────────────────────────────
export { ContextManager, DEFAULT_CONTEXT_CONFIG } from './context.js'

// ─── Usage ─────────────────────────────────────────────────────────
export { UsageTracker, ResourceLimitError, getPricing, PROVIDER_PRICING } from './usage.js'
export type { TokenPrice, UsageSnapshot } from './usage.js'

// ─── Trace & Logging ───────────────────────────────────────────────
export { TraceCollector, TraceReplay, StructuredLogger } from './trace.js'
export type { Trace, TraceEntry, LogEntry, LogLevel } from './trace.js'

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
