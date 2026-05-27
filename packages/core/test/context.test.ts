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
    expect(tokens).toBeLessThan(100) // short messages
  })

  it('should estimate tokens correctly for CJK text', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const tokens = mgr.estimateTextTokens('你好世界这是一个测试')
    // CJK: ~2 chars/token → 11 chars / 2 ≈ 6 tokens
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
    expect(truncated.length).toBeLessThanOrEqual(120) // 10 + suffix
    expect(truncated).toContain('truncated')
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

  it('should prioritize messages correctly', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    expect(mgr.messagePriority({ role: 'system', content: 'sys' })).toBe(100)
    expect(mgr.messagePriority({ role: 'user', content: 'u' })).toBe(80)
    expect(mgr.messagePriority({ role: 'assistant', content: 'a' })).toBe(60)
  })

  it('should compress with sliding window strategy', async () => {
    const mgr = new ContextManager(
      { ...DEFAULT_CONTEXT_CONFIG, compressionStrategy: 'sliding-window', preserveRecentTurns: 2 },
      mockRouter,
    )
    const messages = [
      { role: 'user', content: 'old1' },
      { role: 'assistant', content: 'old2' },
      { role: 'user', content: 'recent1' },
      { role: 'assistant', content: 'recent2' },
      { role: 'user', content: 'latest' },
    ]
    const compressed = await mgr.compress(messages)
    // Should preserve recent turns
    expect(compressed.some(m => m.content === 'latest')).toBe(true)
  })
})
