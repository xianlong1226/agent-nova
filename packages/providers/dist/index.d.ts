import { LanguageModelV1 } from 'ai';

type ProviderId = string;
interface ProviderConfig {
    /** Unique provider identifier */
    id: ProviderId;
    /** Language model instance from Vercel AI SDK */
    model: LanguageModelV1;
    /** Optional display name */
    name?: string;
    /** Cost per 1M input tokens (in USD) */
    costInputPer1M?: number;
    /** Cost per 1M output tokens (in USD) */
    costOutputPer1M?: number;
    /** Context window size in tokens */
    contextWindow?: number;
}
type TaskComplexity = 'simple' | 'complex' | 'coding';
interface RoutingConfig {
    /** Default provider for unspecified tasks */
    default: ProviderId;
    /** Route by task complexity */
    routing?: Partial<Record<TaskComplexity, ProviderId>>;
    /** Fallback chain — tried in order on failure */
    fallbackChain: ProviderId[];
    /** Conditions that trigger fallback */
    fallbackOn?: {
        errorPatterns?: string[];
        timeoutMs?: number;
    };
}
declare class ProviderRouter {
    private providers;
    private routing;
    constructor(providers: ProviderConfig[], routing: RoutingConfig);
    /** Get provider by ID */
    get(id: ProviderId): ProviderConfig | undefined;
    /** Get the default provider */
    getDefault(): ProviderConfig;
    /** Route to a provider based on task complexity */
    route(complexity?: TaskComplexity): ProviderConfig;
    /**
     * Get the fallback chain for a given starting provider.
     * Returns [startProvider, ...fallbackChain excluding start].
     */
    getFallbackChain(): ProviderConfig[];
    /** Check if an error should trigger fallback */
    shouldFallback(error: unknown): boolean;
    /** List all provider IDs */
    listProviders(): ProviderId[];
    /** Get provider config */
    getConfig(id: ProviderId): ProviderConfig | undefined;
}
declare function createRouter(providers: ProviderConfig[], defaultId: string, fallbackChain?: string[]): ProviderRouter;

/**
 * Rate Limiter — token bucket + per-provider limits
 *
 * Strategies:
 * 1. Global token bucket — caps total LPM (calls per minute) / TPM (tokens per minute)
 * 2. Per-provider limits — respects each provider's rate limits
 * 3. Adaptive backoff — auto-slows on 429 responses
 */
interface RateLimiterConfig {
    /** Max API calls per minute globally (default: 60) */
    callsPerMinute?: number;
    /** Max tokens per minute globally (default: 100000) */
    tokensPerMinute?: number;
    /** Per-provider overrides: providerId → { callsPerMinute, tokensPerMinute } */
    perProvider?: Record<string, {
        callsPerMinute?: number;
        tokensPerMinute?: number;
    }>;
    /** Backoff multiplier on 429 (default: 2) */
    backoffMultiplier?: number;
    /** Maximum backoff in ms (default: 60000) */
    maxBackoffMs?: number;
}
declare class RateLimiter {
    private globalCallBucket;
    private globalTokenBucket;
    private providerCallBuckets;
    private providerTokenBuckets;
    private config;
    private providerBackoff;
    constructor(config?: RateLimiterConfig);
    /** Acquire permission to make an API call. Waits if rate limited. */
    acquire(providerId: string, estimatedTokens: number): Promise<void>;
    /** Report a 429 response — triggers adaptive backoff for this provider */
    reportRateLimited(providerId: string, retryAfterMs?: number): void;
    /** Reset backoff for a provider (on successful response) */
    reportSuccess(providerId: string): void;
    /** Get current bucket status for monitoring */
    getStatus(): {
        global: {
            callsRemaining: number;
            tokensRemaining: number;
        };
        providers: Record<string, {
            callsRemaining: number;
            tokensRemaining: number;
            backoffMs: number;
        }>;
    };
    private getProviderCallBucket;
    private getProviderTokenBucket;
    private sleep;
}

/**
 * Create an OpenAI-compatible provider config.
 * Works with OpenAI, DeepSeek, Qwen, or any OpenAI-compatible API.
 */
declare function createOpenAICompatibleProvider(config: {
    id: string;
    name?: string;
    model: string;
    baseURL?: string;
    apiKey?: string;
    contextWindow?: number;
    costInputPer1M?: number;
    costOutputPer1M?: number;
}): ProviderConfig;
/** Preset: OpenAI GPT-4o */
declare function openaiGPT4o(apiKey?: string): ProviderConfig;
/** Preset: DeepSeek Chat */
declare function deepseekChat(apiKey?: string): ProviderConfig;
/** Preset: Qwen Max */
declare function qwenMax(apiKey?: string): ProviderConfig;

/** Preset: Anthropic Claude Sonnet 4 */
declare function claudeSonnet4(apiKey?: string): ProviderConfig;
/** Preset: Anthropic Claude Haiku 3.5 */
declare function claudeHaiku35(apiKey?: string): ProviderConfig;

export { type ProviderConfig, type ProviderId, ProviderRouter, RateLimiter, type RateLimiterConfig, type RoutingConfig, type TaskComplexity, claudeHaiku35, claudeSonnet4, createOpenAICompatibleProvider, createRouter, deepseekChat, openaiGPT4o, qwenMax };
