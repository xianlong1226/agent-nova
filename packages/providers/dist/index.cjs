"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ProviderRouter: () => ProviderRouter,
  claudeHaiku35: () => claudeHaiku35,
  claudeSonnet4: () => claudeSonnet4,
  createOpenAICompatibleProvider: () => createOpenAICompatibleProvider,
  createRouter: () => createRouter,
  deepseekChat: () => deepseekChat,
  openaiGPT4o: () => openaiGPT4o,
  qwenMax: () => qwenMax
});
module.exports = __toCommonJS(index_exports);

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

// src/adapters/openai.ts
var import_openai = require("@ai-sdk/openai");
function createOpenAICompatibleProvider(config) {
  const openai = (0, import_openai.createOpenAI)({
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
var import_anthropic = require("@ai-sdk/anthropic");
function claudeSonnet4(apiKey) {
  const provider = (0, import_anthropic.createAnthropic)({
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
  const provider = (0, import_anthropic.createAnthropic)({
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ProviderRouter,
  claudeHaiku35,
  claudeSonnet4,
  createOpenAICompatibleProvider,
  createRouter,
  deepseekChat,
  openaiGPT4o,
  qwenMax
});
//# sourceMappingURL=index.cjs.map