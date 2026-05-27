import type { ResourceLimits } from '@agentnova/permission'

// ─── Token Pricing ─────────────────────────────────────────────────

export interface TokenPrice {
  inputPer1M: number   // USD per 1M input tokens
  outputPer1M: number  // USD per 1M output tokens
}

// ─── Usage Tracking ────────────────────────────────────────────────

export interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number
  toolCallCount: number
  stepCount: number
  durationMs: number
}

// ─── Usage Tracker ─────────────────────────────────────────────────

export class UsageTracker {
  private inputTokens = 0
  private outputTokens = 0
  private toolCallCount = 0
  private stepCount = 0
  private startTime: number

  constructor(
    private price: TokenPrice,
    private limits: ResourceLimits,
  ) {
    this.startTime = Date.now()
  }

  /** Record token usage from an LLM call */
  recordTokens(input: number, output: number): void {
    this.inputTokens += input
    this.outputTokens += output
  }

  /** Record a tool call */
  recordToolCall(): void {
    this.toolCallCount++
  }

  /** Record a step completion */
  recordStep(): void {
    this.stepCount++
  }

  // ─── Limit Checks ──────────────────────────────────────────────

  /** Check if any limit has been exceeded */
  isLimitExceeded(): { exceeded: boolean; reason?: string } {
    if (this.stepCount >= this.limits.maxSteps) {
      return { exceeded: true, reason: `Max steps (${this.limits.maxSteps}) reached` }
    }
    if (this.totalTokens >= this.limits.maxTokens) {
      return { exceeded: true, reason: `Max tokens (${this.limits.maxTokens}) reached` }
    }
    if (this.toolCallCount >= this.limits.maxToolCalls) {
      return { exceeded: true, reason: `Max tool calls (${this.limits.maxToolCalls}) reached` }
    }
    const elapsed = Date.now() - this.startTime
    if (elapsed >= this.limits.timeoutMs) {
      return { exceeded: true, reason: `Timeout (${this.limits.timeoutMs}ms) reached` }
    }
    return { exceeded: false }
  }

  /** Throw if limit exceeded */
  assertWithinLimits(): void {
    const check = this.isLimitExceeded()
    if (check.exceeded) {
      throw new ResourceLimitError(check.reason!)
    }
  }

  // ─── Getters ───────────────────────────────────────────────────

  get totalTokens(): number {
    return this.inputTokens + this.outputTokens
  }

  get estimatedCost(): number {
    return (
      (this.inputTokens / 1_000_000) * this.price.inputPer1M +
      (this.outputTokens / 1_000_000) * this.price.outputPer1M
    )
  }

  get elapsedMs(): number {
    return Date.now() - this.startTime
  }

  /** Get a snapshot of current usage */
  snapshot(): UsageSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      estimatedCost: this.estimatedCost,
      toolCallCount: this.toolCallCount,
      stepCount: this.stepCount,
      durationMs: this.elapsedMs,
    }
  }

  /** Reset tracker (for new runs) */
  reset(): void {
    this.inputTokens = 0
    this.outputTokens = 0
    this.toolCallCount = 0
    this.stepCount = 0
    this.startTime = Date.now()
  }
}

// ─── Custom Error ──────────────────────────────────────────────────

export class ResourceLimitError extends Error {
  constructor(reason: string) {
    super(`Resource limit exceeded: ${reason}`)
    this.name = 'ResourceLimitError'
  }
}

// ─── Provider Pricing ──────────────────────────────────────────────

export const PROVIDER_PRICING: Record<string, TokenPrice> = {
  'openai-gpt4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28 },
  'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },
  'qwen-max': { inputPer1M: 1.6, outputPer1M: 6.4 },
  'anthropic-sonnet4': { inputPer1M: 3, outputPer1M: 15 },
  'anthropic-haiku35': { inputPer1M: 0.8, outputPer1M: 4 },
}

/** Get pricing for a provider, fallback to GPT-4o pricing */
export function getPricing(providerId: string): TokenPrice {
  return PROVIDER_PRICING[providerId] ?? PROVIDER_PRICING['openai-gpt4o']
}
