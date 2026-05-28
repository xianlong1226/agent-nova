// src/router.ts
var ProviderRouter = class {
  providers = /* @__PURE__ */ new Map();
  routing;
  constructor(providers, routing) {
    for (const p of providers) {
      this.providers.set(p.id, p);
    }
    this.routing = routing;
  }
  /** Get provider by ID */
  get(id) {
    return this.providers.get(id);
  }
  /** Get the default provider */
  getDefault() {
    const p = this.providers.get(this.routing.default);
    if (!p) throw new Error(`Default provider "${this.routing.default}" not found`);
    return p;
  }
  /** Route to a provider based on task complexity */
  route(complexity) {
    if (complexity && this.routing.routing?.[complexity]) {
      const p = this.providers.get(this.routing.routing[complexity]);
      if (p) return p;
    }
    return this.getDefault();
  }
  /**
   * Get the fallback chain for a given starting provider.
   * Returns [startProvider, ...fallbackChain excluding start].
   */
  getFallbackChain() {
    const chain = [];
    const seen = /* @__PURE__ */ new Set();
    const defaultP = this.getDefault();
    chain.push(defaultP);
    seen.add(defaultP.id);
    for (const id of this.routing.fallbackChain) {
      if (seen.has(id)) continue;
      const p = this.providers.get(id);
      if (p) {
        chain.push(p);
        seen.add(id);
      }
    }
    return chain;
  }
  /** Check if an error should trigger fallback */
  shouldFallback(error) {
    if (!this.routing.fallbackOn) return true;
    const msg = error instanceof Error ? error.message : String(error);
    if (this.routing.fallbackOn.errorPatterns) {
      return this.routing.fallbackOn.errorPatterns.some(
        (p) => new RegExp(p, "i").test(msg)
      );
    }
    return true;
  }
  /** List all provider IDs */
  listProviders() {
    return Array.from(this.providers.keys());
  }
  /** Get provider config */
  getConfig(id) {
    return this.providers.get(id);
  }
};
function createRouter(providers, defaultId, fallbackChain) {
  return new ProviderRouter(providers, {
    default: defaultId,
    fallbackChain: fallbackChain ?? []
  });
}

// src/limiter.ts
function createBucket(maxTokens, refillPerSecond) {
  return {
    tokens: maxTokens,
    maxTokens,
    refillRate: refillPerSecond,
    lastRefill: Date.now()
  };
}
function refill(bucket) {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1e3;
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
  bucket.lastRefill = now;
}
function consume(bucket, cost) {
  refill(bucket);
  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return true;
  }
  return false;
}
function waitTimeMs(bucket, cost) {
  refill(bucket);
  const deficit = cost - bucket.tokens;
  if (deficit <= 0) return 0;
  return Math.ceil(deficit / bucket.refillRate * 1e3);
}
var DEFAULT_RATE_LIMITER_CONFIG = {
  callsPerMinute: 60,
  tokensPerMinute: 1e5,
  perProvider: {},
  backoffMultiplier: 2,
  maxBackoffMs: 6e4
};
var RateLimiter = class {
  globalCallBucket;
  globalTokenBucket;
  providerCallBuckets = /* @__PURE__ */ new Map();
  providerTokenBuckets = /* @__PURE__ */ new Map();
  config;
  providerBackoff = /* @__PURE__ */ new Map();
  // providerId → next allowed timestamp
  constructor(config) {
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config };
    this.globalCallBucket = createBucket(
      this.config.callsPerMinute,
      this.config.callsPerMinute / 60
    );
    this.globalTokenBucket = createBucket(
      this.config.tokensPerMinute,
      this.config.tokensPerMinute / 60
    );
  }
  /** Acquire permission to make an API call. Waits if rate limited. */
  async acquire(providerId, estimatedTokens) {
    const backoffUntil = this.providerBackoff.get(providerId) ?? 0;
    if (Date.now() < backoffUntil) {
      const delay = backoffUntil - Date.now();
      await this.sleep(delay);
    }
    const callBucket = this.getProviderCallBucket(providerId);
    const tokenBucket = this.getProviderTokenBucket(providerId);
    let totalWait = 0;
    totalWait = Math.max(totalWait, waitTimeMs(this.globalCallBucket, 1));
    totalWait = Math.max(totalWait, waitTimeMs(this.globalTokenBucket, estimatedTokens));
    totalWait = Math.max(totalWait, waitTimeMs(callBucket, 1));
    totalWait = Math.max(totalWait, waitTimeMs(tokenBucket, estimatedTokens));
    if (totalWait > 0) {
      await this.sleep(totalWait);
    }
    consume(this.globalCallBucket, 1);
    consume(this.globalTokenBucket, estimatedTokens);
    consume(callBucket, 1);
    consume(tokenBucket, estimatedTokens);
  }
  /** Report a 429 response — triggers adaptive backoff for this provider */
  reportRateLimited(providerId, retryAfterMs) {
    const currentBackoff = this.providerBackoff.get(providerId) ?? 0;
    const baseDelay = retryAfterMs ?? 5e3;
    const backoffMs = Math.min(
      baseDelay * this.config.backoffMultiplier,
      this.config.maxBackoffMs
    );
    this.providerBackoff.set(providerId, Math.max(currentBackoff, Date.now() + backoffMs));
  }
  /** Reset backoff for a provider (on successful response) */
  reportSuccess(providerId) {
    this.providerBackoff.delete(providerId);
  }
  /** Get current bucket status for monitoring */
  getStatus() {
    refill(this.globalCallBucket);
    refill(this.globalTokenBucket);
    const providers = {};
    for (const [id] of this.providerCallBuckets) {
      const callBucket = this.providerCallBuckets.get(id);
      const tokenBucket = this.providerTokenBuckets.get(id);
      refill(callBucket);
      refill(tokenBucket);
      const backoffUntil = this.providerBackoff.get(id) ?? 0;
      providers[id] = {
        callsRemaining: Math.floor(callBucket.tokens),
        tokensRemaining: Math.floor(tokenBucket.tokens),
        backoffMs: Math.max(0, backoffUntil - Date.now())
      };
    }
    return {
      global: {
        callsRemaining: Math.floor(this.globalCallBucket.tokens),
        tokensRemaining: Math.floor(this.globalTokenBucket.tokens)
      },
      providers
    };
  }
  // ─── Private ─────────────────────────────────────────────────────
  getProviderCallBucket(providerId) {
    if (!this.providerCallBuckets.has(providerId)) {
      const limit = this.config.perProvider[providerId]?.callsPerMinute ?? this.config.callsPerMinute;
      this.providerCallBuckets.set(providerId, createBucket(limit, limit / 60));
    }
    return this.providerCallBuckets.get(providerId);
  }
  getProviderTokenBucket(providerId) {
    if (!this.providerTokenBuckets.has(providerId)) {
      const limit = this.config.perProvider[providerId]?.tokensPerMinute ?? this.config.tokensPerMinute;
      this.providerTokenBuckets.set(providerId, createBucket(limit, limit / 60));
    }
    return this.providerTokenBuckets.get(providerId);
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};

// src/adapters/openai.ts
import { createOpenAI } from "@ai-sdk/openai";
function createOpenAICompatibleProvider(config) {
  const openai = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey
  });
  return {
    id: config.id,
    name: config.name ?? config.id,
    model: openai(config.model),
    contextWindow: config.contextWindow,
    costInputPer1M: config.costInputPer1M,
    costOutputPer1M: config.costOutputPer1M
  };
}
function openaiGPT4o(apiKey) {
  return createOpenAICompatibleProvider({
    id: "openai-gpt4o",
    name: "OpenAI GPT-4o",
    model: "gpt-4o",
    apiKey: apiKey ?? process.env.OPENAI_API_KEY,
    contextWindow: 128e3,
    costInputPer1M: 2.5,
    costOutputPer1M: 10
  });
}
function deepseekChat(apiKey) {
  return createOpenAICompatibleProvider({
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    model: "deepseek-chat",
    baseURL: "https://api.deepseek.com/v1",
    apiKey: apiKey ?? process.env.DEEPSEEK_API_KEY,
    contextWindow: 64e3,
    costInputPer1M: 0.14,
    costOutputPer1M: 0.28
  });
}
function qwenMax(apiKey) {
  return createOpenAICompatibleProvider({
    id: "qwen-max",
    name: "Qwen Max",
    model: "qwen-max",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: apiKey ?? process.env.QWEN_API_KEY,
    contextWindow: 32e3,
    costInputPer1M: 1.6,
    costOutputPer1M: 6.4
  });
}

// src/adapters/anthropic.ts
import { createAnthropic } from "@ai-sdk/anthropic";
function claudeSonnet4(apiKey) {
  const provider = createAnthropic({
    apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY
  });
  return {
    id: "anthropic-sonnet4",
    name: "Claude Sonnet 4",
    model: provider("claude-sonnet-4-20250514"),
    contextWindow: 2e5,
    costInputPer1M: 3,
    costOutputPer1M: 15
  };
}
function claudeHaiku35(apiKey) {
  const provider = createAnthropic({
    apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY
  });
  return {
    id: "anthropic-haiku35",
    name: "Claude Haiku 3.5",
    model: provider("claude-3-5-haiku-20241022"),
    contextWindow: 2e5,
    costInputPer1M: 0.8,
    costOutputPer1M: 4
  };
}
export {
  ProviderRouter,
  RateLimiter,
  claudeHaiku35,
  claudeSonnet4,
  createOpenAICompatibleProvider,
  createRouter,
  deepseekChat,
  openaiGPT4o,
  qwenMax
};
//# sourceMappingURL=index.js.map