import { createOpenAI } from '@ai-sdk/openai'
import type { ProviderConfig } from '../router.js'

/**
 * Create an OpenAI-compatible provider config.
 * Works with OpenAI, DeepSeek, Qwen, or any OpenAI-compatible API.
 */
export function createOpenAICompatibleProvider(config: {
  id: string
  name?: string
  model: string
  baseURL?: string
  apiKey?: string
  contextWindow?: number
  costInputPer1M?: number
  costOutputPer1M?: number
}): ProviderConfig {
  const openai = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  })

  return {
    id: config.id,
    name: config.name ?? config.id,
    model: openai(config.model),
    contextWindow: config.contextWindow,
    costInputPer1M: config.costInputPer1M,
    costOutputPer1M: config.costOutputPer1M,
  }
}

/** Preset: OpenAI GPT-4o */
export function openaiGPT4o(apiKey?: string): ProviderConfig {
  return createOpenAICompatibleProvider({
    id: 'openai-gpt4o',
    name: 'OpenAI GPT-4o',
    model: 'gpt-4o',
    apiKey: apiKey ?? process.env.OPENAI_API_KEY,
    contextWindow: 128_000,
    costInputPer1M: 2.5,
    costOutputPer1M: 10,
  })
}

/** Preset: DeepSeek Chat */
export function deepseekChat(apiKey?: string): ProviderConfig {
  return createOpenAICompatibleProvider({
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    model: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: apiKey ?? process.env.DEEPSEEK_API_KEY,
    contextWindow: 64_000,
    costInputPer1M: 0.14,
    costOutputPer1M: 0.28,
  })
}

/** Preset: Qwen Max */
export function qwenMax(apiKey?: string): ProviderConfig {
  return createOpenAICompatibleProvider({
    id: 'qwen-max',
    name: 'Qwen Max',
    model: 'qwen-max',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: apiKey ?? process.env.QWEN_API_KEY,
    contextWindow: 32_000,
    costInputPer1M: 1.6,
    costOutputPer1M: 6.4,
  })
}
