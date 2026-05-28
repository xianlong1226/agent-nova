import { generateText, type CoreMessage } from 'ai'
import type { ContextConfig, CompressionStrategy } from './types.js'
import type { ProviderRouter } from '@agentnova/providers'

/**
 * Compression result with metadata for observability
 */
export interface CompressionResult {
  messages: CoreMessage[]
  originalTokenCount: number
  compressedTokenCount: number
  strategy: CompressionStrategy
  summarized?: boolean
  droppedCount: number
}

/**
 * Token budget breakdown — used for intelligent allocation
 */
interface TokenBudget {
  /** Total context window */
  window: number
  /** Usable tokens (after system prompt + response reserve) */
  usable: number
  /** Currently consumed tokens */
  consumed: number
  /** Remaining tokens */
  remaining: number
  /** Tokens needed for next LLM response (estimate) */
  responseReserve: number
}

/**
 * Message with semantic metadata for smarter compression
 */
interface AnnotatedMessage {
  msg: CoreMessage
  index: number
  tokenEstimate: number
  priority: number          // 0-100, higher = more important
  hasReference: boolean     // contains pronouns/back-references
  isToolResult: boolean     // tool output (compressible)
  turnGroup: number         // which conversation turn this belongs to
}

/**
 * Context Manager — production-grade context compression
 *
 * Key improvements over v1:
 * 1. LLM-powered summarization with pronoun resolution (no external summarizer needed)
 * 2. Adaptive memory injection based on remaining budget
 * 3. Progressive compression instead of all-or-nothing
 * 4. Semantic prioritization: references, errors, user decisions get higher priority
 * 5. Token-budget-aware tool output truncation
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
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length
    const totalChars = text.length
    const cjkRatio = totalChars > 0 ? cjkChars / totalChars : 0
    const charsPerToken = cjkRatio > 0.3 ? 2 : (4 - cjkRatio * 2)
    return Math.ceil(totalChars / charsPerToken)
  }

  // ─── Token Budget ────────────────────────────────────────────────

  /** Get the context window size for the current default provider */
  getContextWindow(): number {
    const defaultProvider = this.router.getDefault()
    return defaultProvider.contextWindow ?? 128_000
  }

  /** Get usable context (reserve space for system prompt + response) */
  getUsableContext(): number {
    const window = this.getContextWindow()
    return Math.floor(window * 0.8)
  }

  /** Calculate current token budget */
  getBudget(messages: CoreMessage[]): TokenBudget {
    const window = this.getContextWindow()
    const usable = Math.floor(window * 0.8)
    const consumed = this.estimateTokens(messages)
    // Reserve ~30% of remaining for response, minimum 2000 tokens
    const responseReserve = Math.max(2000, Math.floor((usable - consumed) * 0.3))
    return {
      window,
      usable,
      consumed,
      remaining: Math.max(0, usable - consumed - responseReserve),
      responseReserve,
    }
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
    return Math.min(1 - target / tokens, 0.7)
  }

  // ─── Adaptive Memory Injection ───────────────────────────────────

  /**
   * Calculate how many memory items can be injected given current budget.
   * Returns { topK, maxItemLength } — adaptively scales down when tight.
   */
  calculateMemoryBudget(messages: CoreMessage[], requestedTopK: number): {
    topK: number
    maxItemLength: number
    budgetRemaining: number
  } {
    const budget = this.getBudget(messages)
    const remaining = budget.remaining

    // If less than 2000 tokens remaining, be very conservative
    if (remaining < 2000) {
      return { topK: Math.min(1, requestedTopK), maxItemLength: 200, budgetRemaining: remaining }
    }
    // If less than 5000 tokens, moderate conservation
    if (remaining < 5000) {
      return { topK: Math.min(2, requestedTopK), maxItemLength: 500, budgetRemaining: remaining }
    }
    // If less than 10000 tokens, slight conservation
    if (remaining < 10000) {
      return { topK: Math.min(3, requestedTopK), maxItemLength: 1000, budgetRemaining: remaining }
    }
    // Plenty of room
    return { topK: requestedTopK, maxItemLength: 2000, budgetRemaining: remaining }
  }

  // ─── Compression ─────────────────────────────────────────────────

  /**
   * Compress messages with full metadata tracking.
   * Now supports auto-LLM summarization when no external summarizer is provided.
   */
  async compress(
    messages: CoreMessage[],
    summarizer?: (text: string) => Promise<string>,
  ): Promise<CoreMessage[]> {
    const result = await this.compressWithMeta(messages, summarizer)
    return result.messages
  }

  /**
   * Full compression with observability metadata.
   */
  async compressWithMeta(
    messages: CoreMessage[],
    externalSummarizer?: (text: string) => Promise<string>,
  ): Promise<CompressionResult> {
    const originalTokens = this.estimateTokens(messages)
    if (!this.needsCompression(messages)) {
      return {
        messages,
        originalTokenCount: originalTokens,
        compressedTokenCount: originalTokens,
        strategy: this.config.compressionStrategy,
        droppedCount: 0,
      }
    }

    const [recent, older] = this.splitMessages(messages, this.config.preserveRecentTurns)
    if (older.length === 0) {
      return {
        messages: recent,
        originalTokenCount: originalTokens,
        compressedTokenCount: this.estimateTokens(recent),
        strategy: 'sliding-window',
        droppedCount: older.length,
      }
    }

    switch (this.config.compressionStrategy) {
      case 'sliding-window': {
        return {
          messages: recent,
          originalTokenCount: originalTokens,
          compressedTokenCount: this.estimateTokens(recent),
          strategy: 'sliding-window',
          droppedCount: older.length,
        }
      }

      case 'summary': {
        const summary = await this.summarizeBlock(older, externalSummarizer)
        const result = summary ? [summary, ...recent] : recent
        return {
          messages: result,
          originalTokenCount: originalTokens,
          compressedTokenCount: this.estimateTokens(result),
          strategy: 'summary',
          summarized: !!summary,
          droppedCount: older.length,
        }
      }

      case 'hybrid':
      default: {
        // Progressive compression strategy:
        // 1. Annotate messages with semantic metadata
        // 2. Try LLM summary first (most intelligent)
        // 3. Fall back to semantic extraction if LLM unavailable
        const annotated = this.annotateMessages(older)

        // Try LLM-powered summary
        const summary = await this.summarizeBlock(annotated.map(a => a.msg), externalSummarizer)
        const keyMessages = this.extractKeyMessagesSemantic(annotated)

        if (summary) {
          const result = [summary, ...recent]
          return {
            messages: result,
            originalTokenCount: originalTokens,
            compressedTokenCount: this.estimateTokens(result),
            strategy: 'hybrid',
            summarized: true,
            droppedCount: older.length - keyMessages.length,
          }
        }

        // No summarizer available — semantic extraction
        const result = [...keyMessages, ...recent]
        return {
          messages: result,
          originalTokenCount: originalTokens,
          compressedTokenCount: this.estimateTokens(result),
          strategy: 'hybrid',
          droppedCount: older.length - keyMessages.length,
        }
      }
    }
  }

  // ─── Progressive Compression ─────────────────────────────────────

  /**
   * Proactively compress after a tool call that returns large output.
   * Called by Agent before the tool result is added to messages.
   */
  async compressAfterToolCall(
    messages: CoreMessage[],
    toolOutputTokens: number,
    summarizer?: (text: string) => Promise<string>,
  ): Promise<CoreMessage[]> {
    const budget = this.getBudget(messages)
    // If tool output would push us over 85% threshold, proactively compress
    const projectedTokens = budget.consumed + toolOutputTokens
    const threshold = budget.usable * 0.85

    if (projectedTokens > threshold) {
      return this.compress(messages, summarizer)
    }
    return messages
  }

  // ─── Tool Output Handling ────────────────────────────────────────

  /** Truncate a tool output to fit budget, with awareness of remaining space */
  truncateToolOutput(output: unknown, messages?: CoreMessage[]): string {
    let str: string
    try {
      str = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
    } catch {
      str = String(output)
    }

    // If we have messages context, use budget-aware truncation
    if (messages) {
      const budget = this.getBudget(messages)
      // Max tool output should not exceed 40% of remaining budget
      const maxGivenBudget = Math.floor(budget.remaining * 0.4)
      const effectiveMax = Math.min(this.config.maxToolOutputLength, maxGivenBudget)
      if (str.length <= effectiveMax) return str

      if (this.config.toolOutputTruncate === 'head') {
        return str.slice(0, effectiveMax) + '\n... [truncated]'
      }
      return '... [truncated]\n' + str.slice(-effectiveMax)
    }

    // Fallback: use configured max
    if (str.length <= this.config.maxToolOutputLength) return str

    if (this.config.toolOutputTruncate === 'head') {
      return str.slice(0, this.config.maxToolOutputLength) + '\n... [truncated]'
    }
    return '... [truncated]\n' + str.slice(-this.config.maxToolOutputLength)
  }

  // ─── Message Priorities (Semantic) ──────────────────────────────

  /**
   * Assign priority to a message based on semantic content analysis.
   * This is much smarter than the v1 version that only looked at role.
   */
  messagePriority(msg: CoreMessage): number {
    const text = this.extractText(msg).toLowerCase()
    let priority = 20 // base for tool results

    // Role-based base priority
    if (msg.role === 'system') return 100
    if (msg.role === 'user') priority = 70

    // Boost: contains error/failure information (critical for Agent to avoid repeating)
    if (/\b(error|fail|exception|bug|wrong|incorrect|doesn'?t work|not found)\b/.test(text)) {
      priority += 25
    }

    // Boost: contains definitive user decisions/preferences
    if (/\b(i want|use|don'?t use|prefer|always|never|must|should|please)\b/.test(text)) {
      priority += 20
    }

    // Boost: contains references to earlier context (pronoun-heavy = needs context)
    if (/\b(it|that|this|the above|previous|earlier|just|recently)\b/.test(text)) {
      priority += 15
    }

    // Boost: assistant messages with substantial reasoning (not just tool calls)
    if (msg.role === 'assistant' && text.length > 100) {
      priority += 10
    }

    // Boost: contains numeric values, file paths, or config (hard to reconstruct)
    if (/[\d]+\.[\d]+|\/[\w/]+\.[\w]+|localhost|0\.0\.0\.0|=\s*["']/.test(text)) {
      priority += 10
    }

    return Math.min(priority, 100)
  }

  // ─── Private: Annotation ─────────────────────────────────────────

  /** Annotate messages with semantic metadata for smarter compression */
  private annotateMessages(messages: CoreMessage[]): AnnotatedMessage[] {
    let turnGroup = 0
    let lastUserRole = -1

    return messages.map((msg, index) => {
      const text = this.extractText(msg)
      if (msg.role === 'user' && index > lastUserRole) {
        turnGroup++
        lastUserRole = index
      }

      return {
        msg,
        index,
        tokenEstimate: this.estimateTextTokens(text) + 4,
        priority: this.messagePriority(msg),
        hasReference: /\b(it|that|this|the above|previous|earlier)\b/i.test(text),
        isToolResult: text.startsWith('[Tool') || msg.role === 'tool',
        turnGroup,
      }
    })
  }

  // ─── Private: Semantic Key Message Extraction ────────────────────

  /**
   * Extract key messages using semantic annotations.
   * Much smarter than v1 — preserves error info, pronoun references, and user decisions.
   */
  private extractKeyMessages(annotated: AnnotatedMessage[]): CoreMessage[] {
    const HIGH_PRIORITY_THRESHOLD = 60
    const MAX_TOOL_RESULT_LEN = 500

    // Always keep high-priority messages
    const kept: AnnotatedMessage[] = []
    const dropped: AnnotatedMessage[] = []

    for (const am of annotated) {
      if (am.priority >= HIGH_PRIORITY_THRESHOLD) {
        kept.push(am)
      } else if (am.isToolResult && am.tokenEstimate < MAX_TOOL_RESULT_LEN) {
        // Keep short tool results (they might be error messages)
        kept.push(am)
      } else {
        dropped.push(am)
      }
    }

    // If we dropped too much, try to keep some medium-priority messages
    if (dropped.length > annotated.length * 0.5) {
      dropped
        .filter(am => am.priority >= 40)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, Math.ceil(annotated.length * 0.2))
        .forEach(am => kept.push(am))
    }

    // Sort by original order
    kept.sort((a, b) => a.index - b.index)

    // Compress tool outputs further
    return kept.map(am => {
      if (am.isToolResult && am.tokenEstimate > MAX_TOOL_RESULT_LEN) {
        const text = this.extractText(am.msg)
        return {
          ...am.msg,
          content: `[Tool Result Summary]: ${text.slice(0, MAX_TOOL_RESULT_LEN)}...`,
        } as CoreMessage
      }
      return am.msg
    })
  }

  /** Alias for backward compat */
  private extractKeyMessagesSemantic = this.extractKeyMessages

  // ─── Private: Summarization ──────────────────────────────────────

  /**
   * Summarize a block of messages.
   * Strategy:
   * 1. If external summarizer provided, use it
   * 2. Otherwise, try using the Agent's own LLM (via router) for auto-summarization
   * 3. If neither works, fall back to semantic extraction
   */
  private async summarizeBlock(
    messages: CoreMessage[],
    externalSummarizer?: (text: string) => Promise<string>,
  ): Promise<CoreMessage | null> {
    if (messages.length === 0) return null

    // 1. External summarizer (highest priority)
    if (externalSummarizer) {
      const text = this.formatMessagesForSummary(messages)
      const summary = await externalSummarizer(text)
      return this.buildSummaryMessage(summary)
    }

    // 2. Auto-summarize using the Agent's own LLM
    try {
      const provider = this.router.getDefault()
      const text = this.formatMessagesForSummary(messages)

      const result = await generateText({
        model: provider.model,
        system: `You are a conversation compressor. Summarize the following conversation history into a concise summary that:
1. Preserves all user decisions, preferences, and instructions
2. Resolves pronouns (replace "it", "that" with the actual referent)
3. Keeps error messages and their resolutions
4. Notes any file paths, config values, or specific technical details
5. Tracks the sequence of actions taken
Be concise but complete. Use bullet points for clarity.`,
        prompt: text,
        maxTokens: 1000,
      })

      return this.buildSummaryMessage(result.text)
    } catch {
      // LLM summarization failed — will fall back to semantic extraction in caller
      return null
    }
  }

  /** Format messages for summarization input */
  private formatMessagesForSummary(messages: CoreMessage[]): string {
    return messages
      .map((m) => {
        const content = this.extractText(m)
        // Truncate very long tool outputs before feeding to summarizer
        const truncated = content.length > 3000
          ? content.slice(0, 1500) + '\n...[truncated]...\n' + content.slice(-1500)
          : content
        return `[${m.role}]: ${truncated}`
      })
      .join('\n\n')
  }

  /** Build a summary message with standard format */
  private buildSummaryMessage(summary: string): CoreMessage {
    return {
      role: 'system',
      content: `[Conversation Summary — earlier context compressed]\n${summary}`,
    }
  }

  // ─── Private: Message Splitting ──────────────────────────────────

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
