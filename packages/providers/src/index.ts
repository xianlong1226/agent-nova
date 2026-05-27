export { ProviderRouter, createRouter } from './router.js'
export type { ProviderConfig, ProviderId, RoutingConfig, TaskComplexity } from './router.js'

export {
  createOpenAICompatibleProvider,
  openaiGPT4o,
  deepseekChat,
  qwenMax,
} from './adapters/openai.js'

export {
  claudeSonnet4,
  claudeHaiku35,
} from './adapters/anthropic.js'
