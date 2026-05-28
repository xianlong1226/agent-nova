import { describe, it, expect, beforeEach } from 'vitest'
import { TraceCollector, TraceReplay } from '../src/trace.js'
import { StructuredLogger } from '../src/logger.js'
import type { Trace } from '../src/trace.js'

describe('TraceCollector', () => {
  let collector: TraceCollector

  beforeEach(() => {
    collector = new TraceCollector('deepseek-chat')
  })

  it('should record entries', () => {
    collector.record('step', { step: 0 })
    collector.record('tool_call', { tool: 'fs.readFile', args: { path: 'a.ts' } })
    const entries = collector.getEntries()
    expect(entries.length).toBe(2)
    expect(entries[0].type).toBe('step')
    expect(entries[1].type).toBe('tool_call')
  })

  it('should build trace snapshot', () => {
    collector.record('step', { step: 0 })
    const trace = collector.buildTrace([], 100, 0.01)
    expect(trace.id).toContain('trace_')
    expect(trace.provider).toBe('deepseek-chat')
    expect(trace.totalTokens).toBe(100)
    expect(trace.totalCost).toBe(0.01)
    expect(trace.entries.length).toBe(1)
  })

  it('should reset state', () => {
    collector.record('step', { step: 0 })
    collector.reset('openai-gpt4o')
    expect(collector.getEntries().length).toBe(0)
  })
})

describe('TraceReplay', () => {
  it('should generate summary', () => {
    const collector = new TraceCollector('deepseek-chat')
    collector.record('step', { step: 0 })
    collector.record('tool_call', { tool: 'fs.readFile', args: { path: 'test.ts' } })
    collector.record('tool_result', { tool: 'fs.readFile', output: 'ok' })
    collector.record('llm_call', { tokens: 500 })
    collector.record('compression', {})
    collector.record('provider_fallback', { from: 'deepseek-chat', error: 'rate_limit' })

    const trace = collector.buildTrace([], 500, 0.001)
    const replay = new TraceReplay(trace)
    const summary = replay.summary()

    expect(summary).toContain('deepseek-chat')
    expect(summary).toContain('STEP #0')
    expect(summary).toContain('fs.readFile')
    expect(summary).toContain('LLM call')
    expect(summary).toContain('Context compressed')
    expect(summary).toContain('Fallback')
  })

  it('should export JSON', () => {
    const collector = new TraceCollector('test')
    collector.record('step', { step: 0 })
    const trace = collector.buildTrace([], 0, 0)
    const replay = new TraceReplay(trace)
    const json = replay.toJSON()
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('should replay step by step', async () => {
    const collector = new TraceCollector('test')
    collector.record('step', { step: 0 })
    collector.record('step', { step: 1 })
    const trace = collector.buildTrace([], 0, 0)
    const replay = new TraceReplay(trace)

    const steps: number[] = []
    await replay.replay({
      onStep: (entry) => { steps.push(entry.timestamp) },
      delayMs: 0,
    })
    expect(steps.length).toBe(2)
  })
})

describe('StructuredLogger', () => {
  let logger: StructuredLogger

  beforeEach(() => {
    logger = new StructuredLogger({ minLevel: 'debug', traceId: 'test_123' })
  })

  it('should log at all levels', () => {
    logger.debug('debug msg', { key: 1 })
    logger.info('info msg')
    logger.warn('warn msg')
    logger.error('error msg', { code: 'ERR' })

    const logs = logger.getLogs()
    expect(logs.length).toBe(4)
    expect(logs[0].level).toBe('debug')
    expect(logs[3].data?.code).toBe('ERR')
  })

  it('should filter by minimum level', () => {
    const warnLogger = new StructuredLogger({ minLevel: 'warn' })
    warnLogger.debug('no')
    warnLogger.info('no')
    warnLogger.warn('yes')
    warnLogger.error('yes')

    expect(warnLogger.getLogs().length).toBe(2)
  })

  it('should filter logs by level', () => {
    logger.info('info1')
    logger.error('error1')
    logger.info('info2')

    expect(logger.getLogs('info').length).toBe(2)
    expect(logger.getLogs('error').length).toBe(1)
  })

  it('should include trace ID', () => {
    logger.info('test')
    const logs = logger.getLogs()
    expect(logs[0].traceId).toBe('test_123')
  })

  it('should export NDJSON', () => {
    logger.info('first')
    logger.warn('second')
    const ndjson = logger.exportNDJSON()
    const lines = ndjson.split('\n')
    expect(lines.length).toBe(2)
    expect(() => JSON.parse(lines[0])).not.toThrow()
  })

  it('should clear logs', () => {
    logger.info('a')
    logger.clear()
    expect(logger.getLogs().length).toBe(0)
  })
})
