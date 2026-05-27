import type { LanguageModelV1 } from 'ai'

// ─── Provider Types ────────────────────────────────────────────────

export type ProviderId = string

export interface ProviderConfig {
  /** Unique provider identifier */
  id: ProviderId
  /** Language model instance from Vercel AI SDK */
  model: LanguageModelV1
  /** Optional display name */
  name?: string
  /** Cost per 1M input tokens (in USD) */
  costInputPer1M?: number
  /** Cost per 1M output tokens (in USD) */
  costOutputPer1M?: number
  /** Context window size in tokens */
  contextWindow?: number
}

// ─── Routing Strategy ──────────────────────────────────────────────

export type TaskComplexity = 'simple' | 'complex' | 'coding'

export interface RoutingConfig {
  /** Default provider for unspecified tasks */
  default: ProviderId
  /** Route by task complexity */
  routing?: Partial<Record<TaskComplexity, ProviderId>>
  /** Fallback chain — tried in order on failure */
  fallbackChain: ProviderId[]
  /** Conditions that trigger fallback */
  fallbackOn?: {
    errorPatterns?: string[]
    timeoutMs?: number
  }
}

// ─── Provider Router ───────────────────────────────────────────────

export class ProviderRouter {
  private providers: Map<ProviderId, ProviderConfig> = new Map()
  private routing: RoutingConfig

  constructor(
    providers: ProviderConfig[],
    routing: RoutingConfig,
  ) {
    for (const p of providers) {
      this.providers.set(p.id, p)
    }
    this.routing = routing
  }

  /** Get provider by ID */
  get(id: ProviderId): ProviderConfig | undefined {
    return this.providers.get(id)
  }

  /** Get the default provider */
  getDefault(): ProviderConfig {
    const p = this.providers.get(this.routing.default)
    if (!p) throw new Error(`Default provider "${this.routing.default}" not found`)
    return p
  }

  /** Route to a provider based on task complexity */
  route(complexity?: TaskComplexity): ProviderConfig {
    if (complexity && this.routing.routing?.[complexity]) {
      const p = this.providers.get(this.routing.routing[complexity]!)
      if (p) return p
    }
    return this.getDefault()
  }

  /**
   * Get the fallback chain for a given starting provider.
   * Returns [startProvider, ...fallbackChain excluding start].
   */
  getFallbackChain(): ProviderConfig[] {
    const chain: ProviderConfig[] = []
    const seen = new Set<ProviderId>()

    // Include default first
    const defaultP = this.getDefault()
    chain.push(defaultP)
    seen.add(defaultP.id)

    // Then fallbacks
    for (const id of this.routing.fallbackChain) {
      if (seen.has(id)) continue
      const p = this.providers.get(id)
      if (p) {
        chain.push(p)
        seen.add(id)
      }
    }

    return chain
  }

  /** Check if an error should trigger fallback */
  shouldFallback(error: unknown): boolean {
    if (!this.routing.fallbackOn) return true // fallback on any error by default

    const msg = error instanceof Error ? error.message : String(error)

    if (this.routing.fallbackOn.errorPatterns) {
      return this.routing.fallbackOn.errorPatterns.some(p =>
        new RegExp(p, 'i').test(msg)
      )
    }

    return true
  }

  /** List all provider IDs */
  listProviders(): ProviderId[] {
    return Array.from(this.providers.keys())
  }

  /** Get provider config */
  getConfig(id: ProviderId): ProviderConfig | undefined {
    return this.providers.get(id)
  }
}

// ─── Helper: Quick setup ───────────────────────────────────────────

export function createRouter(
  providers: ProviderConfig[],
  defaultId: string,
  fallbackChain?: string[],
): ProviderRouter {
  return new ProviderRouter(providers, {
    default: defaultId,
    fallbackChain: fallbackChain ?? [],
  })
}
