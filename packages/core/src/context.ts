import type { CoreMessage } from 'ai'
import type { ContextConfig, CompressionStrategy } from './types.js'
import type { ProviderRouter } from '@agentnova/providers'

/**
 * Context Manager — keeps the conversation within token budget
 * by compressing older messages and truncating tool output.
 */
export class ContextManager {
  private config: ContextConfig

  constructor(
    config: ContextConfig,
    private router: ProviderRouter,
  ) {
    this.config = config
  }

  /** Estimate token count for messages (rough: 1 token ≈ 4 chars) */
  estimateTokens(messages: CoreMessage[]): number {
    const total = messages.reduce((sum, msg) => {
      if (typeof msg.content === 'string') {
        return sum + Math.ceil(msg.content.length / 4)
      }
      // Handle array content (tool results, etc.)
      if (Array.isArray(msg.content)) {
        return sum + msg.content.reduce((s, part) => {
          if (part.type === 'text') return s + Math.ceil(part.text.length / 4)
          if (part.type === 'tool-result') {
            const resultStr = typeof part.result === 'string' ? part.result : JSON.stringify(part.result)
            return s + Math.ceil(resultStr.length / 4)
          }
          return s
        }, 0)
      }
      return sum
    }, 0)
    return total
  }

  /** Get the context window size for current provider */
  getContextWindow(): number {
    const defaultProvider = this.router.getDefault()
    return defaultProvider.contextWindow ?? 128_000
  }

  /** Check if compression is needed */
  needsCompression(messages: CoreMessage[]): boolean {
    const tokens = this.estimateTokens(messages)
    const threshold = this.getContextWindow() * this.config.compressionTriggerRatio
    return tokens > threshold
  }

  /**
   * Compress messages if needed.
   * Returns potentially reduced message array.
   */
  async compress(messages: CoreMessage[], summarizer?: (text: string) => Promise<string>): Promise<CoreMessage[]> {
    if (!this.needsCompression(messages)) return messages

    const [recent, older] = this.splitMessages(messages, this.config.preserveRecentTurns)

    if (older.length === 0) return recent

    switch (this.config.compressionStrategy) {
      case 'sliding-window':
        return recent // Just drop older messages

      case 'summary': {
        if (summarizer) {
          const summary = await this.summarizeMessages(older, summarizer)
          return [summary, ...recent]
        }
        // Without summarizer, fall back to sliding window
        return recent
      }

      case 'hybrid':
      default: {
        if (summarizer) {
          const summary = await this.summarizeMessages(older, summarizer)
          return [summary, ...recent]
        }
        // Keep key messages (tool calls + user inputs), drop tool results
        const keyMessages = this.extractKeyMessages(older)
        return [...keyMessages, ...recent]
      }
    }
  }

  /** Truncate a tool output to fit budget */
  truncateToolOutput(output: unknown): string {
    const str = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
    if (str.length <= this.config.maxToolOutputLength) return str

    if (this.config.toolOutputTruncate === 'head') {
      return '... [truncated]\n' + str.slice(-this.config.maxToolOutputLength)
    }
    return str.slice(0, this.config.maxToolOutputLength) + '\n... [truncated]'
  }

  /** Split messages at the N-th most recent turn boundary */
  private splitMessages(messages: CoreMessage[], preserveRecent: number): [CoreMessage[], CoreMessage[]] {
    // Count "turns" — a turn = user message + assistant message + optional tool results
    let turnCount = 0
    let splitIndex = messages.length

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        turnCount++
        if (turnCount > preserveRecent) {
          splitIndex = i
          break
        }
      }
    }

    return [messages.slice(splitIndex), messages.slice(0, splitIndex)]
  }

  /** Summarize a block of older messages */
  private async summarizeMessages(
    messages: CoreMessage[],
    summarizer: (text: string) => Promise<string>,
  ): Promise<CoreMessage> {
    const text = messages
      .map((m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return `[${m.role}]: ${content}`
      })
      .join('\n')

    const summary = await summarizer(text)
    return {
      role: 'system',
      content: `[Conversation Summary]\n${summary}`,
    }
  }

  /** Extract key messages (user + assistant without large tool results) */
  private extractKeyMessages(messages: CoreMessage[]): CoreMessage[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        // Truncate tool results to essential info
        return {
          ...msg,
          content: this.truncateToolOutput(msg.content),
        }
      }
      return msg
    })
  }
}
