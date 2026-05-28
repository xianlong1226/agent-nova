import { describe, it, expect } from 'vitest'
import { ContextManager, DEFAULT_CONTEXT_CONFIG } from '../src/context.js'

// Minimal ProviderRouter mock
const mockRouter = {
  getDefault: () => ({ contextWindow: 128_000, id: 'test' }),
} as any

describe('ContextManager', () => {
  it('should estimate tokens correctly for English text', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const messages = [
      { role: 'user' as const, content: 'Hello world!' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ]
    const tokens = mgr.estimateTokens(messages)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(100)
  })

  it('should estimate tokens correctly for CJK text', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const tokens = mgr.estimateTextTokens('你好世界这是一个测试')
    expect(tokens).toBeGreaterThan(3)
    expect(tokens).toBeLessThan(20)
  })

  it('should detect when compression is needed', () => {
    const mgr = new ContextManager(
      { ...DEFAULT_CONTEXT_CONFIG, compressionTriggerRatio: 0.5 },
      mockRouter,
    )
    const bigContent = 'x'.repeat(600_000)
    const messages = [{ role: 'user' as const, content: bigContent }]
    expect(mgr.needsCompression(messages)).toBe(true)
  })

  it('should not compress when within budget', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const messages = [{ role: 'user' as const, content: 'Hello' }]
    expect(mgr.needsCompression(messages)).toBe(false)
  })

  it('should truncate tool output', () => {
    const mgr = new ContextManager(
      { ...DEFAULT_CONTEXT_CONFIG, maxToolOutputLength: 10 },
      mockRouter,
    )
    const longOutput = 'a'.repeat(100)
    const truncated = mgr.truncateToolOutput(longOutput)
    expect(truncated.length).toBeLessThanOrEqual(120)
    expect(truncated).toContain('truncated')
  })

  it('should truncate tool output with budget awareness', () => {
    const mgr = new ContextManager(
      { ...DEFAULT_CONTEXT_CONFIG, maxToolOutputLength: 10_000 },
      mockRouter,
    )
    const messages = [{ role: 'user', content: 'Hello' }]
    const longOutput = 'b'.repeat(5000)
    const truncated = mgr.truncateToolOutput(longOutput, messages)
    // Should still work even with budget context
    expect(truncated.length).toBeGreaterThan(0)
  })

  it('should calculate compression ratio', () => {
    const mgr = new ContextManager(
      { ...DEFAULT_CONTEXT_CONFIG, compressionTriggerRatio: 0.7 },
      mockRouter,
    )
    const smallMessages = [{ role: 'user' as const, content: 'hi' }]
    expect(mgr.compressionRatio(smallMessages)).toBe(0)

    const bigMessages = [{ role: 'user' as const, content: 'x'.repeat(800_000) }]
    expect(mgr.compressionRatio(bigMessages)).toBeGreaterThan(0)
  })

  it('should adapt to different provider context windows', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    expect(mgr.getContextWindow()).toBe(128_000)
    expect(mgr.getUsableContext()).toBeLessThan(128_000)
  })

  it('should prioritize system messages highest', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    expect(mgr.messagePriority({ role: 'system', content: 'sys' })).toBe(100)
  })

  it('should boost priority for error messages', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const normalUser = mgr.messagePriority({ role: 'user', content: 'please do something' })
    const errorUser = mgr.messagePriority({ role: 'user', content: 'Error: file not found' })
    expect(errorUser).toBeGreaterThan(normalUser)
  })

  it('should boost priority for user preferences', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const normalUser = mgr.messagePriority({ role: 'user', content: 'check the file' })
    const prefUser = mgr.messagePriority({ role: 'user', content: 'I prefer using tabs' })
    expect(prefUser).toBeGreaterThan(normalUser)
  })

  it('should boost priority for messages with references', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const normalAsst = mgr.messagePriority({ role: 'assistant', content: 'The result is 42' })
    const refAsst = mgr.messagePriority({ role: 'assistant', content: 'Based on that, I updated it' })
    expect(refAsst).toBeGreaterThan(normalAsst)
  })

  it('should compress with sliding window strategy', async () => {
    const mgr = new ContextManager(
      { ...DEFAULT_CONTEXT_CONFIG, compressionStrategy: 'sliding-window', preserveRecentTurns: 2 },
      mockRouter,
    )
    const messages = [
      { role: 'user' as const, content: 'old1' },
      { role: 'assistant' as const, content: 'old2' },
      { role: 'user' as const, content: 'recent1' },
      { role: 'assistant' as const, content: 'recent2' },
      { role: 'user' as const, content: 'latest' },
    ]
    const compressed = await mgr.compress(messages)
    expect(compressed.some(m => m.content === 'latest')).toBe(true)
  })

  it('should calculate token budget', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'World' },
    ]
    const budget = mgr.getBudget(messages)
    expect(budget.window).toBe(128_000)
    expect(budget.usable).toBeLessThan(128_000)
    expect(budget.consumed).toBeGreaterThan(0)
    expect(budget.remaining).toBeGreaterThan(0)
  })

  it('should calculate memory budget adaptively', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)

    // Tight budget → conservative (fill up most of the window)
    const tightMessages = [{ role: 'user', content: 'x'.repeat(500_000) }]
    const tightBudget = mgr.calculateMemoryBudget(tightMessages, 5)
    expect(tightBudget.topK).toBeLessThanOrEqual(2)

    // Plenty of room → full allocation
    const roomyMessages = [{ role: 'user', content: 'hi' }]
    const roomyBudget = mgr.calculateMemoryBudget(roomyMessages, 5)
    expect(roomyBudget.topK).toBe(5)
  })

  it('should compress with metadata tracking', async () => {
    const mgr = new ContextManager(
      { ...DEFAULT_CONTEXT_CONFIG, compressionStrategy: 'sliding-window', preserveRecentTurns: 1 },
      mockRouter,
    )
    const messages = [
      { role: 'user' as const, content: 'old1' },
      { role: 'assistant' as const, content: 'old2' },
      { role: 'user' as const, content: 'recent' },
    ]
    const result = await mgr.compressWithMeta(messages)
    expect(result.originalTokenCount).toBeGreaterThan(0)
    expect(result.compressedTokenCount).toBeGreaterThan(0)
    expect(result.droppedCount).toBeGreaterThanOrEqual(0)
  })
})
