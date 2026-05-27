import type { CoreMessage } from 'ai'
import type { ContextConfig, CompressionStrategy } from './types.js'
import type { ProviderRouter } from '@agentnova/providers'

/**
 * Context Manager — keeps the conversation within token budget
 * by compressing older messages, truncating tool output,
 * and dynamically adapting to the current provider's context window.
 */
export class ContextManager {
  private config: ContextConfig

  constructor(
    config: ContextConfig,
    private router: ProviderRouter,
  ) {
    this.config = config
  }

  // ─── Token Estimation ────────────────────────────────────────────

  /**
   * Estimate token count for messages.
   * Uses a heuristic: ~4 chars per token for English, ~2 chars per token for CJK.
   * Falls back to 3.5 chars/token average for mixed content.
   */
  estimateTokens(messages: CoreMessage[]): number {
    let total = 0
    for (const msg of messages) {
      const text = this.extractText(msg)
      total += this.estimateTextTokens(text)
    }
    // Add overhead per message (~4 tokens for role markers, formatting)
    total += messages.length * 4
    return total
  }

  /** Estimate tokens for a single text string */
  estimateTextTokens(text: string): number {
    if (!text) return 0
    // Detect CJK ratio
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length
    const totalChars = text.length
    const cjkRatio = totalChars > 0 ? cjkChars / totalChars : 0

    // CJK: ~2 chars/token, English: ~4 chars/token, mixed: weighted
    const charsPerToken = cjkRatio > 0.3 ? 2 : (4 - cjkRatio * 2)
    return Math.ceil(totalChars / charsPerToken)
  }

  // ─── Context Window ──────────────────────────────────────────────

  /** Get the context window size for the current default provider */
  getContextWindow(): number {
    const defaultProvider = this.router.getDefault()
    return defaultProvider.contextWindow ?? 128_000
  }

  /** Get usable context (reserve space for system prompt + response) */
  getUsableContext(): number {
    const window = this.getContextWindow()
    // Reserve ~20% for system prompt + response generation
    return Math.floor(window * 0.8)
  }

  /** Check if compression is needed */
  needsCompression(messages: CoreMessage[]): boolean {
    const tokens = this.estimateTokens(messages)
    const threshold = this.getContextWindow() * this.config.compressionTriggerRatio
    return tokens > threshold
  }

  /** Calculate how much we need to compress (0-1) */
  compressionRatio(messages: CoreMessage[]): number {
    const tokens = this.estimateTokens(messages)
    const target = this.getUsableContext()
    if (tokens <= target) return 0
    return Math.min(1 - target / tokens, 0.7) // max 70% compression
  }

  // ─── Compression ─────────────────────────────────────────────────

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
        return recent

      case 'summary': {
        if (summarizer) {
          const summary = await this.summarizeMessages(older, summarizer)
          return [summary, ...recent]
        }
        return recent
      }

      case 'hybrid':
      default: {
        if (summarizer) {
          const summary = await this.summarizeMessages(older, summarizer)
          return [summary, ...recent]
        }
        const keyMessages = this.extractKeyMessages(older)
        return [...keyMessages, ...recent]
      }
    }
  }

  // ─── Tool Output Handling ────────────────────────────────────────

  /** Truncate a tool output to fit budget */
  truncateToolOutput(output: unknown): string {
    const str = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
    if (str.length <= this.config.maxToolOutputLength) return str

    if (this.config.toolOutputTruncate === 'head') {
      return str.slice(0, this.config.maxToolOutputLength) + '\n... [truncated]'
    }
    // Default: tail (keep the end, more useful for logs)
    return '... [truncated]\n' + str.slice(-this.config.maxToolOutputLength)
  }

  // ─── Message Priorities ──────────────────────────────────────────

  /** Assign priority to a message (higher = more important to keep) */
  messagePriority(msg: CoreMessage): number {
    // System messages: highest priority
    if (msg.role === 'system') return 100
    // User messages: high priority
    if (msg.role === 'user') return 80
    // Assistant messages with no tool calls: medium-high
    if (msg.role === 'assistant') return 60
    // Tool messages: low priority (can be summarized)
    return 20
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  /** Split messages at the N-th most recent turn boundary */
  private splitMessages(messages: CoreMessage[], preserveRecent: number): [CoreMessage[], CoreMessage[]] {
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

  /** Summarize a block of older messages using LLM */
  private async summarizeMessages(
    messages: CoreMessage[],
    summarizer: (text: string) => Promise<string>,
  ): Promise<CoreMessage> {
    const text = messages
      .map((m) => {
        const content = this.extractText(m)
        return `[${m.role}]: ${content}`
      })
      .join('\n')

    const summary = await summarizer(text)
    return {
      role: 'system',
      content: `[Conversation Summary]\n${summary}`,
    }
  }

  /** Extract key messages (user + assistant, compress tool results) */
  private extractKeyMessages(messages: CoreMessage[]): CoreMessage[] {
    return messages.map((msg) => {
      const text = this.extractText(msg)
      if (msg.role === 'system' || msg.role === 'user') return msg
      if (msg.role === 'assistant') {
        // Keep assistant messages but strip empty ones
        return text.trim() ? msg : null
      }
      // Tool/user-as-tool: compress to short form
      return {
        role: 'user' as const,
        content: `[Tool Output]: ${this.truncateToolOutput(text)}`,
      }
    }).filter(Boolean) as CoreMessage[]
  }

  /** Extract plain text from a message */
  private extractText(msg: CoreMessage): string {
    if (typeof msg.content === 'string') return msg.content
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((part) => {
          if (part.type === 'text') return part.text
          if ('text' in part && typeof part.text === 'string') return part.text
          return ''
        })
        .join('\n')
    }
    return ''
  }

  // ─── Adaptive Window ─────────────────────────────────────────────

  /**
   * Adapt compression settings based on the current provider.
   * Called when the active provider changes.
   */
  adaptToProvider(): void {
    const window = this.getContextWindow()
    // Adjust preserveRecentTurns based on context window size
    if (window <= 32_000) {
      this.config = { ...this.config, preserveRecentTurns: 5, compressionTriggerRatio: 0.5 }
    } else if (window <= 128_000) {
      this.config = { ...this.config, preserveRecentTurns: 10, compressionTriggerRatio: 0.7 }
    } else {
      this.config = { ...this.config, preserveRecentTurns: 15, compressionTriggerRatio: 0.75 }
    }
  }
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  preserveRecentTurns: 10,
  compressionTriggerRatio: 0.7,
  compressionStrategy: 'hybrid',
  maxToolOutputLength: 8_000,
  toolOutputTruncate: 'tail',
}
