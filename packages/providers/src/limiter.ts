/**
 * Rate Limiter — token bucket + per-provider limits
 *
 * Strategies:
 * 1. Global token bucket — caps total LPM (calls per minute) / TPM (tokens per minute)
 * 2. Per-provider limits — respects each provider's rate limits
 * 3. Adaptive backoff — auto-slows on 429 responses
 */

// ─── Bucket ────────────────────────────────────────────────────────

interface TokenBucket {
  /** Current tokens available */
  tokens: number
  /** Maximum tokens the bucket can hold */
  maxTokens: number
  /** Tokens added per second */
  refillRate: number
  /** Last refill timestamp */
  lastRefill: number
}

function createBucket(maxTokens: number, refillPerSecond: number): TokenBucket {
  return {
    tokens: maxTokens,
    maxTokens,
    refillRate: refillPerSecond,
    lastRefill: Date.now(),
  }
}

function refill(bucket: TokenBucket): void {
  const now = Date.now()
  const elapsed = (now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate)
  bucket.lastRefill = now
}

function consume(bucket: TokenBucket, cost: number): boolean {
  refill(bucket)
  if (bucket.tokens >= cost) {
    bucket.tokens -= cost
    return true
  }
  return false
}

function waitTimeMs(bucket: TokenBucket, cost: number): number {
  refill(bucket)
  const deficit = cost - bucket.tokens
  if (deficit <= 0) return 0
  return Math.ceil((deficit / bucket.refillRate) * 1000)
}

// ─── Rate Limiter Config ───────────────────────────────────────────

export interface RateLimiterConfig {
  /** Max API calls per minute globally (default: 60) */
  callsPerMinute?: number
  /** Max tokens per minute globally (default: 100000) */
  tokensPerMinute?: number
  /** Per-provider overrides: providerId → { callsPerMinute, tokensPerMinute } */
  perProvider?: Record<string, { callsPerMinute?: number; tokensPerMinute?: number }>
  /** Backoff multiplier on 429 (default: 2) */
  backoffMultiplier?: number
  /** Maximum backoff in ms (default: 60000) */
  maxBackoffMs?: number
}

export const DEFAULT_RATE_LIMITER_CONFIG: Required<RateLimiterConfig> = {
  callsPerMinute: 60,
  tokensPerMinute: 100_000,
  perProvider: {},
  backoffMultiplier: 2,
  maxBackoffMs: 60_000,
}

// ─── Rate Limiter ──────────────────────────────────────────────────

export class RateLimiter {
  private globalCallBucket: TokenBucket
  private globalTokenBucket: TokenBucket
  private providerCallBuckets = new Map<string, TokenBucket>()
  private providerTokenBuckets = new Map<string, TokenBucket>()
  private config: Required<RateLimiterConfig>
  private providerBackoff = new Map<string, number>() // providerId → next allowed timestamp

  constructor(config?: RateLimiterConfig) {
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config }

    this.globalCallBucket = createBucket(
      this.config.callsPerMinute,
      this.config.callsPerMinute / 60,
    )
    this.globalTokenBucket = createBucket(
      this.config.tokensPerMinute,
      this.config.tokensPerMinute / 60,
    )
  }

  /** Acquire permission to make an API call. Waits if rate limited. */
  async acquire(providerId: string, estimatedTokens: number): Promise<void> {
    // Check provider backoff first (from 429)
    const backoffUntil = this.providerBackoff.get(providerId) ?? 0
    if (Date.now() < backoffUntil) {
      const delay = backoffUntil - Date.now()
      await this.sleep(delay)
    }

    // Get or create provider-specific buckets
    const callBucket = this.getProviderCallBucket(providerId)
    const tokenBucket = this.getProviderTokenBucket(providerId)

    // Calculate total wait time
    let totalWait = 0
    totalWait = Math.max(totalWait, waitTimeMs(this.globalCallBucket, 1))
    totalWait = Math.max(totalWait, waitTimeMs(this.globalTokenBucket, estimatedTokens))
    totalWait = Math.max(totalWait, waitTimeMs(callBucket, 1))
    totalWait = Math.max(totalWait, waitTimeMs(tokenBucket, estimatedTokens))

    if (totalWait > 0) {
      await this.sleep(totalWait)
    }

    // Consume from all buckets
    consume(this.globalCallBucket, 1)
    consume(this.globalTokenBucket, estimatedTokens)
    consume(callBucket, 1)
    consume(tokenBucket, estimatedTokens)
  }

  /** Report a 429 response — triggers adaptive backoff for this provider */
  reportRateLimited(providerId: string, retryAfterMs?: number): void {
    const currentBackoff = this.providerBackoff.get(providerId) ?? 0
    const baseDelay = retryAfterMs ?? 5000
    const backoffMs = Math.min(
      baseDelay * this.config.backoffMultiplier,
      this.config.maxBackoffMs,
    )
    this.providerBackoff.set(providerId, Math.max(currentBackoff, Date.now() + backoffMs))
  }

  /** Reset backoff for a provider (on successful response) */
  reportSuccess(providerId: string): void {
    this.providerBackoff.delete(providerId)
  }

  /** Get current bucket status for monitoring */
  getStatus(): {
    global: { callsRemaining: number; tokensRemaining: number }
    providers: Record<string, { callsRemaining: number; tokensRemaining: number; backoffMs: number }>
  } {
    refill(this.globalCallBucket)
    refill(this.globalTokenBucket)

    const providers: Record<string, any> = {}
    for (const [id] of this.providerCallBuckets) {
      const callBucket = this.providerCallBuckets.get(id)!
      const tokenBucket = this.providerTokenBuckets.get(id)!
      refill(callBucket)
      refill(tokenBucket)
      const backoffUntil = this.providerBackoff.get(id) ?? 0
      providers[id] = {
        callsRemaining: Math.floor(callBucket.tokens),
        tokensRemaining: Math.floor(tokenBucket.tokens),
        backoffMs: Math.max(0, backoffUntil - Date.now()),
      }
    }

    return {
      global: {
        callsRemaining: Math.floor(this.globalCallBucket.tokens),
        tokensRemaining: Math.floor(this.globalTokenBucket.tokens),
      },
      providers,
    }
  }

  // ─── Private ─────────────────────────────────────────────────────

  private getProviderCallBucket(providerId: string): TokenBucket {
    if (!this.providerCallBuckets.has(providerId)) {
      const limit = this.config.perProvider[providerId]?.callsPerMinute ?? this.config.callsPerMinute
      this.providerCallBuckets.set(providerId, createBucket(limit, limit / 60))
    }
    return this.providerCallBuckets.get(providerId)!
  }

  private getProviderTokenBucket(providerId: string): TokenBucket {
    if (!this.providerTokenBuckets.has(providerId)) {
      const limit = this.config.perProvider[providerId]?.tokensPerMinute ?? this.config.tokensPerMinute
      this.providerTokenBuckets.set(providerId, createBucket(limit, limit / 60))
    }
    return this.providerTokenBuckets.get(providerId)!
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
