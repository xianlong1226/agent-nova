import { describe, it, expect } from 'vitest'
import { UsageTracker, ResourceLimitError, getPricing, PROVIDER_PRICING } from '../src/usage.js'
import { DEFAULT_LIMITS } from '@agentnova/contracts'

describe('UsageTracker', () => {
  it('should track token usage', () => {
    const tracker = new UsageTracker(
      { inputPer1M: 2.5, outputPer1M: 10 },
      DEFAULT_LIMITS,
    )
    tracker.recordTokens(1000, 500)
    expect(tracker.totalTokens).toBe(1500)
  })

  it('should estimate cost correctly', () => {
    const tracker = new UsageTracker(
      { inputPer1M: 2.5, outputPer1M: 10 },
      DEFAULT_LIMITS,
    )
    tracker.recordTokens(1_000_000, 1_000_000)
    expect(tracker.estimatedCost).toBeCloseTo(12.5, 2) // $2.5 + $10
  })

  it('should track tool calls and steps', () => {
    const tracker = new UsageTracker(
      { inputPer1M: 0, outputPer1M: 0 },
      DEFAULT_LIMITS,
    )
    tracker.recordToolCall()
    tracker.recordToolCall()
    tracker.recordStep()
    const snap = tracker.snapshot()
    expect(snap.toolCallCount).toBe(2)
    expect(snap.stepCount).toBe(1)
  })

  it('should detect step limit exceeded', () => {
    const limits = { ...DEFAULT_LIMITS, maxSteps: 2 }
    const tracker = new UsageTracker(
      { inputPer1M: 0, outputPer1M: 0 },
      limits,
    )
    tracker.recordStep()
    tracker.recordStep()
    const check = tracker.isLimitExceeded()
    expect(check.exceeded).toBe(true)
    expect(check.reason).toContain('Max steps')
  })

  it('should detect token limit exceeded', () => {
    const limits = { ...DEFAULT_LIMITS, maxTokens: 100 }
    const tracker = new UsageTracker(
      { inputPer1M: 0, outputPer1M: 0 },
      limits,
    )
    tracker.recordTokens(50, 60)
    const check = tracker.isLimitExceeded()
    expect(check.exceeded).toBe(true)
    expect(check.reason).toContain('Max tokens')
  })

  it('should detect tool call limit exceeded', () => {
    const limits = { ...DEFAULT_LIMITS, maxToolCalls: 1 }
    const tracker = new UsageTracker(
      { inputPer1M: 0, outputPer1M: 0 },
      limits,
    )
    tracker.recordToolCall()
    tracker.recordToolCall()
    const check = tracker.isLimitExceeded()
    expect(check.exceeded).toBe(true)
    expect(check.reason).toContain('Max tool calls')
  })

  it('should throw ResourceLimitError on assertWithinLimits', () => {
    const limits = { ...DEFAULT_LIMITS, maxSteps: 1 }
    const tracker = new UsageTracker(
      { inputPer1M: 0, outputPer1M: 0 },
      limits,
    )
    tracker.recordStep()
    tracker.recordStep()
    expect(() => tracker.assertWithinLimits()).toThrow(ResourceLimitError)
  })

  it('should reset state correctly', () => {
    const tracker = new UsageTracker(
      { inputPer1M: 2.5, outputPer1M: 10 },
      DEFAULT_LIMITS,
    )
    tracker.recordTokens(1000, 500)
    tracker.recordStep()
    tracker.reset()
    expect(tracker.totalTokens).toBe(0)
    expect(tracker.snapshot().stepCount).toBe(0)
  })

  it('should produce valid snapshot', () => {
    const tracker = new UsageTracker(
      { inputPer1M: 2.5, outputPer1M: 10 },
      DEFAULT_LIMITS,
    )
    tracker.recordTokens(1000, 500)
    tracker.recordToolCall()
    tracker.recordStep()
    const snap = tracker.snapshot()
    expect(snap.inputTokens).toBe(1000)
    expect(snap.outputTokens).toBe(500)
    expect(snap.totalTokens).toBe(1500)
    expect(snap.toolCallCount).toBe(1)
    expect(snap.stepCount).toBe(1)
    expect(snap.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('getPricing', () => {
  it('should return pricing for known providers', () => {
    const p = getPricing('deepseek-chat')
    expect(p.inputPer1M).toBe(0.14)
    expect(p.outputPer1M).toBe(0.28)
  })

  it('should fallback for unknown providers', () => {
    const p = getPricing('unknown-provider')
    expect(p.inputPer1M).toBeDefined()
    expect(p.outputPer1M).toBeDefined()
  })
})
