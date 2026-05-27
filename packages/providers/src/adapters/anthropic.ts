import { anthropic } from '@ai-sdk/anthropic'
import type { ProviderConfig } from '../router.js'

/** Preset: Anthropic Claude Sonnet 4 */
export function claudeSonnet4(apiKey?: string): ProviderConfig {
  const provider = anthropic({
    apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
  })

  return {
    id: 'anthropic-sonnet4',
    name: 'Claude Sonnet 4',
    model: provider('claude-sonnet-4-20250514'),
    contextWindow: 200_000,
    costInputPer1M: 3,
    costOutputPer1M: 15,
  }
}

/** Preset: Anthropic Claude Haiku 3.5 */
export function claudeHaiku35(apiKey?: string): ProviderConfig {
  const provider = anthropic({
    apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
  })

  return {
    id: 'anthropic-haiku35',
    name: 'Claude Haiku 3.5',
    model: provider('claude-3-5-haiku-20241022'),
    contextWindow: 200_000,
    costInputPer1M: 0.8,
    costOutputPer1M: 4,
  }
}
