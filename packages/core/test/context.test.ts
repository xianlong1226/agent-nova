import { describe, it, expect } from 'vitest'
import { ContextManager, DEFAULT_CONTEXT_CONFIG } from '../src/context.js'

describe('ContextManager', () => {
  // We need a minimal ProviderRouter mock
  const mockRouter = {
    getDefault: () => ({ contextWindow: 128_000 }),
  } as any

  it('should estimate tokens correctly', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const messages = [
      { role: 'user' as const, content: 'Hello world!' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ]
    const tokens = mgr.estimateTokens(messages)
    // "Hello world!" = 12 chars → 3 tokens, "Hi there!" = 9 chars → 3 tokens
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(100)
  })

  it('should detect when compression is needed', () => {
    const mgr = new ContextManager(
      { ...DEFAULT_CONTEXT_CONFIG, compressionTriggerRatio: 0.5 },
      mockRouter,
    )
    // Create a large message set
    const bigContent = 'x'.repeat(600_000) // ~150K tokens estimated
    const messages = [
      { role: 'user' as const, content: bigContent },
    ]
    expect(mgr.needsCompression(messages)).toBe(true)
  })

  it('should not compress when within budget', () => {
    const mgr = new ContextManager(DEFAULT_CONTEXT_CONFIG, mockRouter)
    const messages = [
      { role: 'user' as const, content: 'Hello' },
    ]
    expect(mgr.needsCompression(messages)).toBe(false)
  })

  it('should truncate tool output', () => {
    const mgr = new ContextManager(
      { ...DEFAULT_CONTEXT_CONFIG, maxToolOutputLength: 10 },
      mockRouter,
    )
    const longOutput = 'a'.repeat(100)
    const truncated = mgr.truncateToolOutput(longOutput)
    expect(truncated.length).toBeLessThanOrEqual(100) // 10 + truncation suffix
    expect(truncated).toContain('truncated')
  })
})
