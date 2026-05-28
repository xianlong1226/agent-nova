/**
 * Structured Error System — production-grade error handling
 *
 * All Agent errors carry a machine-readable code, retry strategy,
 * and contextual metadata. No more string matching on error messages.
 */

// ─── Error Codes ───────────────────────────────────────────────────

export type ErrorCode =
  // Provider errors
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_QUOTA'
  | 'PROVIDER_MODEL_NOT_FOUND'
  | 'PROVIDER_SERVER_ERROR'
  | 'PROVIDER_NETWORK'
  // Tool errors
  | 'TOOL_NOT_FOUND'
  | 'TOOL_VALIDATION'
  | 'TOOL_PERMISSION_DENIED'
  | 'TOOL_EXECUTION'
  | 'TOOL_TIMEOUT'
  | 'TOOL_ABORTED'
  // Memory errors
  | 'MEMORY_STORAGE'
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_CORRUPTION'
  // Context errors
  | 'CONTEXT_OVERFLOW'
  | 'CONTEXT_COMPRESSION_FAILED'
  // Resource limits
  | 'LIMIT_STEPS'
  | 'LIMIT_TOKENS'
  | 'LIMIT_TOOL_CALLS'
  | 'LIMIT_TIMEOUT'
  | 'LIMIT_COST'
  // Session errors
  | 'SESSION_CONCURRENT'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CORRUPTION'
  // Config errors
  | 'CONFIG_INVALID'
  | 'CONFIG_MISSING'

// ─── Retry Strategy ────────────────────────────────────────────────

export type RetryCategory = 'never' | 'immediate' | 'backoff' | 'after_cooldown'

const RETRY_STRATEGY: Record<ErrorCode, RetryCategory> = {
  // Provider — most are retryable
  PROVIDER_TIMEOUT: 'backoff',
  PROVIDER_RATE_LIMIT: 'after_cooldown',
  PROVIDER_AUTH: 'never',
  PROVIDER_QUOTA: 'after_cooldown',
  PROVIDER_MODEL_NOT_FOUND: 'never',
  PROVIDER_SERVER_ERROR: 'backoff',
  PROVIDER_NETWORK: 'backoff',
  // Tool — some retryable
  TOOL_NOT_FOUND: 'never',
  TOOL_VALIDATION: 'never',
  TOOL_PERMISSION_DENIED: 'never',
  TOOL_EXECUTION: 'never',
  TOOL_TIMEOUT: 'backoff',
  TOOL_ABORTED: 'never',
  // Memory — generally not retryable
  MEMORY_STORAGE: 'backoff',
  MEMORY_NOT_FOUND: 'never',
  MEMORY_CORRUPTION: 'never',
  // Context
  CONTEXT_OVERFLOW: 'immediate',
  CONTEXT_COMPRESSION_FAILED: 'never',
  // Limits — not retryable (need user action)
  LIMIT_STEPS: 'never',
  LIMIT_TOKENS: 'never',
  LIMIT_TOOL_CALLS: 'never',
  LIMIT_TIMEOUT: 'never',
  LIMIT_COST: 'never',
  // Session
  SESSION_CONCURRENT: 'after_cooldown',
  SESSION_NOT_FOUND: 'never',
  SESSION_CORRUPTION: 'never',
  // Config
  CONFIG_INVALID: 'never',
  CONFIG_MISSING: 'never',
}

// ─── AgentError Class ──────────────────────────────────────────────

export class AgentError extends Error {
  readonly code: ErrorCode
  readonly retry: RetryCategory
  readonly cause?: Error
  readonly context: Record<string, unknown>
  readonly timestamp: number

  constructor(options: {
    code: ErrorCode
    message: string
    cause?: Error
    context?: Record<string, unknown>
  }) {
    super(options.message)
    this.name = 'AgentError'
    this.code = options.code
    this.retry = RETRY_STRATEGY[options.code]
    this.cause = options.cause
    this.context = options.context ?? {}
    this.timestamp = Date.now()
  }

  /** Check if this error is retryable */
  get retryable(): boolean {
    return this.retry !== 'never'
  }

  /** Get recommended delay before retry (ms) */
  get retryDelayMs(): number {
    switch (this.retry) {
      case 'immediate': return 0
      case 'backoff': return 1000 + Math.random() * 2000
      case 'after_cooldown': return 30000 + Math.random() * 30000
      default: return Infinity
    }
  }

  /** Serialize for logging/persistence */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retry: this.retry,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp,
      cause: this.cause?.message,
    }
  }

  /** Create from an unknown thrown value */
  static from(err: unknown, code?: ErrorCode): AgentError {
    if (err instanceof AgentError) return err
    if (err instanceof Error) {
      return new AgentError({
        code: code ?? inferCode(err),
        message: err.message,
        cause: err,
      })
    }
    return new AgentError({
      code: code ?? 'TOOL_EXECUTION',
      message: String(err),
    })
  }
}

// ─── Error Code Inference ──────────────────────────────────────────

/** Infer error code from error message or type */
function inferCode(err: Error): ErrorCode  {
  const msg = err.message.toLowerCase()

  // Provider errors
  if (/timeout|timed out|etimedout/i.test(msg)) return 'PROVIDER_TIMEOUT'
  if (/429|rate limit|too many requests/i.test(msg)) return 'PROVIDER_RATE_LIMIT'
  if (/401|403|unauthorized|forbidden|invalid api key/i.test(msg)) return 'PROVIDER_AUTH'
  if (/402|quota|billing|insufficient/i.test(msg)) return 'PROVIDER_QUOTA'
  if (/404|model not found|does not exist/i.test(msg)) return 'PROVIDER_MODEL_NOT_FOUND'
  if (/500|502|503|internal server|service unavailable/i.test(msg)) return 'PROVIDER_SERVER_ERROR'
  if (/econnrefused|enotfound|network|fetch failed/i.test(msg)) return 'PROVIDER_NETWORK'

  // Tool errors
  if (/unknown tool|tool not found/i.test(msg)) return 'TOOL_NOT_FOUND'
  if (/invalid input|validation|parse/i.test(msg)) return 'TOOL_VALIDATION'
  if (/permission denied|not allowed/i.test(msg)) return 'TOOL_PERMISSION_DENIED'
  if (/abort/i.test(msg)) return 'TOOL_ABORTED'

  // Resource limits
  if (/max steps|maxstep/i.test(msg)) return 'LIMIT_STEPS'
  if (/max token/i.test(msg)) return 'LIMIT_TOKENS'
  if (/timeout.*limit/i.test(msg)) return 'LIMIT_TIMEOUT'

  return 'TOOL_EXECUTION'
}

// ─── Error Helpers ─────────────────────────────────────────────────

/** Check if an error is retryable */
export function isRetryable(err: unknown): boolean {
  if (err instanceof AgentError) return err.retryable
  // Be conservative - unknown errors are generally retryable
  return true
}

/** Get recommended retry delay */
export function getRetryDelay(err: unknown): number {
  if (err instanceof AgentError) return err.retryDelayMs
  const code = inferCode(err instanceof Error ? err : new Error(String(err)))
  return RETRY_STRATEGY[code] === 'never' ? Infinity : 2000
}

/** Wrap a provider error with structured code */
export function wrapProviderError(err: unknown, providerId?: string): AgentError {
  return AgentError.from(err, inferCode(err instanceof Error ? err : new Error(String(err))))
}

/** Create a tool execution error */
export function toolError(tool: string, message: string, cause?: Error): AgentError {
  return new AgentError({
    code: 'TOOL_EXECUTION',
    message: `Tool "${tool}" failed: ${message}`,
    cause,
    context: { tool },
  })
}
