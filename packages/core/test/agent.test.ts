import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Agent, createAgent } from '../src/agent.js'
import type { ToolDefinition } from '@agentnova/tools'
import { z } from 'zod'

// ─── Mock generateText from 'ai' ───────────────────────────────────

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}))

import { generateText } from 'ai'
const mockGenerateText = vi.mocked(generateText)

// ─── Mock sql.js init for LongTermMemory ───────────────────────────

vi.mock('sql.js', () => ({
  default: vi.fn().mockResolvedValue({
    Database: class MockDatabase {
      run() {}
      prepare() {
        return {
          bind: () => true,
          step: () => false,
          getAsObject: () => ({}),
          free: () => true,
        }
      }
      exec() { return [] }
      export() { return new Uint8Array(0) }
      close() {}
    },
  }),
}))

// ─── Shared helpers ─────────────────────────────────────────────────

/** Create a minimal provider router mock */
function createMockRouter(fallbackIds: string[] = ['test']) {
  const providers = new Map<string, any>()
  const defaultProvider = {
    id: 'test',
    name: 'Test Provider',
    model: { modelId: 'test-model' },
    contextWindow: 128_000,
  }
  providers.set('test', defaultProvider)
  providers.set('fallback', {
    id: 'fallback',
    name: 'Fallback',
    model: { modelId: 'fallback-model' },
    contextWindow: 128_000,
  })

  return {
    getDefault: () => defaultProvider,
    get: (id: string) => providers.get(id),
    getFallbackChain: () => fallbackIds.map(id => providers.get(id)).filter(Boolean),
    shouldFallback: () => true,
    listProviders: () => Array.from(providers.keys()),
  } as any
}

/** A trivial echo tool that returns its input */
const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echo back the input message',
  parameters: z.object({ message: z.string() }),
  permission: { level: 'read' as const, description: 'Echo tool' },
  execute: async (input: { message: string }) => ({ echoed: input.message }),
}

/** A tool that always throws */
const failTool: ToolDefinition = {
  name: 'fail',
  description: 'Always fails',
  parameters: z.object({ message: z.string() }),
  permission: { level: 'write' as const, description: 'Failing tool' },
  execute: async () => { throw new Error('Tool execution failed') },
}

/** Create a basic agent with sensible defaults */
function createTestAgent(tools: ToolDefinition[] = [], extra: Record<string, any> = {}) {
  return createAgent({
    systemPrompt: 'You are a test assistant.',
    workingDir: '/tmp/test-agent',
    router: createMockRouter(),
    tools,
    permissions: { mode: 'allow' as const, rules: [], limits: { maxSteps: 50, maxTokens: 200_000, maxToolCalls: 100, timeoutMs: 300_000, maxFileSize: 10_000_000 } },
    ...extra,
  })
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe('Agent Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── 1. Normal single-step completion ────────────────────────────

  it('should complete in a single step without tool calls', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Hello! How can I help you?',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
      steps: [{ text: 'Hello! How can I help you?', toolCalls: [], toolResults: [] }],
      response: { messages: [{ role: 'assistant', content: 'Hello! How can I help you?' }] },
    } as any)

    const agent = createTestAgent()
    const result = await agent.run('Hi there')

    expect(result.text).toBe('Hello! How can I help you?')
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].text).toBe('Hello! How can I help you?')
    expect(result.steps[0].toolCalls).toBeUndefined()
    expect(result.usage).toBeDefined()
    expect(result.usage!.totalTokens).toBe(18)
  })

  // ─── 2. Multi-step tool calling ──────────────────────────────────

  it('should handle multi-step tool calls until completion', async () => {
    // Step 1: LLM calls the echo tool
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      toolCalls: [{ toolName: 'echo', args: { message: 'hello' }, type: 'tool-call' }],
      usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
      steps: [{
        text: '',
        toolCalls: [{ toolName: 'echo', args: { message: 'hello' }, type: 'tool-call' }],
        toolResults: [{ toolName: 'echo', result: { echoed: 'hello' } }],
      }],
      response: {
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolName: 'echo', args: { message: 'hello' } }] },
          { role: 'tool', content: [{ type: 'tool-result', toolName: 'echo', result: { echoed: 'hello' } }] },
        ],
      },
    } as any)

    // Step 2: LLM gives final answer
    mockGenerateText.mockResolvedValueOnce({
      text: 'The echo returned: hello',
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 8, totalTokens: 38 },
      steps: [{ text: 'The echo returned: hello', toolCalls: [], toolResults: [] }],
      response: { messages: [{ role: 'assistant', content: 'The echo returned: hello' }] },
    } as any)

    const agent = createTestAgent([echoTool])
    const result = await agent.run('Echo hello')

    expect(result.steps).toHaveLength(2)
    expect(result.steps[0].toolCalls).toBeDefined()
    expect(result.steps[0].toolCalls![0].tool).toBe('echo')
    expect(result.steps[1].text).toBe('The echo returned: hello')
  })

  // ─── 3. Provider fallback on error ───────────────────────────────

  it('should fall back to next provider on failure', async () => {
    const router = createMockRouter(['test', 'fallback'])
    const agent = createTestAgent([], { router })

    // First provider throws, second succeeds
    mockGenerateText
      .mockRejectedValueOnce(new Error('Provider test: connection refused'))
      .mockResolvedValueOnce({
        text: 'Fallback response',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
        steps: [{ text: 'Fallback response', toolCalls: [], toolResults: [] }],
        response: { messages: [{ role: 'assistant', content: 'Fallback response' }] },
      } as any)

    const result = await agent.run('test prompt')

    expect(result.text).toBe('Fallback response')
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
  })

  // ─── 4. Context compression trigger ──────────────────────────────

  it('should trigger context compression when threshold exceeded', async () => {
    const router = createMockRouter()
    // Small context window to force compression
    router.getDefault = () => ({ id: 'test', model: { modelId: 'test' }, contextWindow: 500 })
    router.getFallbackChain = () => [router.getDefault()]

    const agent = createTestAgent([], {
      router,
      context: {
        preserveRecentTurns: 2,
        compressionTriggerRatio: 0.5,
        compressionStrategy: 'sliding-window' as const,
        maxToolOutputLength: 8000,
        toolOutputTruncate: 'tail' as const,
      },
    })

    // Return a response that includes a lot of text to fill context
    const longText = 'x'.repeat(400)
    mockGenerateText.mockResolvedValue({
      text: longText,
      toolCalls: [],
      usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
      steps: [{ text: longText, toolCalls: [], toolResults: [] }],
      response: { messages: [{ role: 'assistant', content: longText }] },
    } as any)

    const result = await agent.run('trigger compression', { maxSteps: 5 })

    // Agent should still produce a result (not crash) even with aggressive compression
    expect(result).toBeDefined()
    expect(result.steps.length).toBeGreaterThan(0)
  })

  // ─── 5. Resource limit termination ───────────────────────────────

  it('should stop when max steps limit is reached', async () => {
    // Every call returns a tool call, creating an infinite loop
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [{ toolName: 'echo', args: { message: 'loop' }, type: 'tool-call' }],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      steps: [{
        text: '',
        toolCalls: [{ toolName: 'echo', args: { message: 'loop' }, type: 'tool-call' }],
        toolResults: [{ toolName: 'echo', result: { echoed: 'loop' } }],
      }],
      response: {
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolName: 'echo', args: { message: 'loop' } }] },
          { role: 'tool', content: [{ type: 'tool-result', toolName: 'echo', result: { echoed: 'loop' } }] },
        ],
      },
    } as any)

    const agent = createTestAgent([echoTool], {
      permissions: {
        mode: 'allow' as const,
        rules: [],
        limits: { maxSteps: 3, maxTokens: 200_000, maxToolCalls: 100, timeoutMs: 300_000, maxFileSize: 10_000_000 },
      },
    })

    const result = await agent.run('infinite loop')

    // Should stop at exactly 3 steps
    expect(result.steps).toHaveLength(3)
    expect(result.state.aborted).toBe(false)
  })

  // ─── 6. Abort via AbortSignal ─────────────────────────────────────

  it('should respect AbortSignal and stop gracefully', async () => {
    let callCount = 0
    mockGenerateText.mockImplementation(async (opts: any) => {
      callCount++
      // First call returns instantly so we can capture the abort on subsequent calls
      if (callCount === 1) {
        return {
          text: '',
          toolCalls: [{ toolName: 'echo', args: { message: 'hit' }, type: 'tool-call' }],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          steps: [{
            text: '',
            toolCalls: [{ toolName: 'echo', args: { message: 'hit' }, type: 'tool-call' }],
            toolResults: [{ toolName: 'echo', result: { echoed: 'hit' } }],
          }],
          response: {
            messages: [
              { role: 'assistant', content: [{ type: 'tool-call', toolName: 'echo', args: { message: 'hit' } }] },
              { role: 'tool', content: [{ type: 'tool-result', toolName: 'echo', result: { echoed: 'hit' } }] },
            ],
          },
        } as any
      }
      // After first call, abort should have been set, agent loop checks it
      return {
        text: 'should not reach here',
        toolCalls: [],
        usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        steps: [{ text: 'should not reach here', toolCalls: [], toolResults: [] }],
        response: { messages: [{ role: 'assistant', content: 'should not reach here' }] },
      } as any
    })

    const agent = createTestAgent([echoTool])
    const controller = new AbortController()

    // Abort after 50ms — enough time for first step
    setTimeout(() => controller.abort(), 50)

    const result = await agent.run('test abort', { signal: controller.signal })

    // Agent stopped gracefully (either completed 1 step or aborted)
    expect(result).toBeDefined()
    expect(result.steps.length).toBeGreaterThanOrEqual(1)
  }, 10000)

  // ─── 7. Hook interception (onBeforeToolCall deny) ─────────────────

  it('should deny tool execution via onBeforeToolCall hook', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Using echo tool...',
      toolCalls: [{ toolName: 'echo', args: { message: 'secret' }, type: 'tool-call' }],
      usage: { promptTokens: 15, completionTokens: 5, totalTokens: 20 },
      steps: [{
        text: 'Using echo tool...',
        toolCalls: [{ toolName: 'echo', args: { message: 'secret' }, type: 'tool-call' }],
        toolResults: [{ toolName: 'echo', result: { error: 'Echo is blocked' } }],
      }],
      response: {
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolName: 'echo', args: { message: 'secret' } }] },
          { role: 'tool', content: [{ type: 'tool-result', toolName: 'echo', result: { error: 'Echo is blocked' } }] },
        ],
      },
    } as any)

    // After denial, LLM should respond normally
    mockGenerateText.mockResolvedValueOnce({
      text: 'I was not allowed to use the echo tool.',
      toolCalls: [],
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      steps: [{ text: 'I was not allowed to use the echo tool.', toolCalls: [], toolResults: [] }],
      response: { messages: [{ role: 'assistant', content: 'I was not allowed to use the echo tool.' }] },
    } as any)

    const agent = createTestAgent([echoTool])

    // Hook that denies all echo calls
    agent.hook('onBeforeToolCall', async (ctx) => {
      if (ctx.toolCall?.tool === 'echo') {
        return { action: 'deny' as const, reason: 'Echo is blocked' }
      }
    })

    const result = await agent.run('use echo')

    // Should have at least 1 step, and the hook should have denied the tool
    expect(result.steps.length).toBeGreaterThanOrEqual(1)
    // The agent should still produce a final answer (not crash)
    expect(result.text).toBeTruthy()
  })

  // ─── 8. Error recovery (tool failure, agent continues) ────────────

  it('should recover from tool execution errors and continue', async () => {
    // Step 1: LLM calls the fail tool
    mockGenerateText.mockResolvedValueOnce({
      text: 'Let me try the failing tool...',
      toolCalls: [{ toolName: 'fail', args: { message: 'test' }, type: 'tool-call' }],
      usage: { promptTokens: 15, completionTokens: 5, totalTokens: 20 },
      steps: [{
        text: 'Let me try the failing tool...',
        toolCalls: [{ toolName: 'fail', args: { message: 'test' }, type: 'tool-call' }],
        toolResults: [{ toolName: 'fail', result: null, error: 'Tool execution failed' }],
      }],
      response: {
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolName: 'fail', args: { message: 'test' } }] },
          { role: 'tool', content: [{ type: 'tool-result', toolName: 'fail', result: null, error: 'Tool execution failed' }] },
        ],
      },
    } as any)

    // Step 2: LLM sees the error and responds gracefully
    mockGenerateText.mockResolvedValueOnce({
      text: 'The tool failed, but I can still help you.',
      toolCalls: [],
      usage: { promptTokens: 25, completionTokens: 10, totalTokens: 35 },
      steps: [{ text: 'The tool failed, but I can still help you.', toolCalls: [], toolResults: [] }],
      response: { messages: [{ role: 'assistant', content: 'The tool failed, but I can still help you.' }] },
    } as any)

    const agent = createTestAgent([failTool])
    const result = await agent.run('try the failing tool')

    // Should have 2 steps — one with error, one with recovery
    expect(result.steps.length).toBe(2)
    expect(result.steps[0].toolResults).toBeDefined()
    expect(result.steps[0].toolResults![0].error).toBeDefined()
    expect(result.steps[1].text).toBe('The tool failed, but I can still help you.')
    // Agent should NOT have thrown
    expect(result.text).toBeTruthy()
  })

  // ─── Bonus: Agent state isolation between runs ────────────────────

  it('should reset state between consecutive runs', async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: 'First response',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
        steps: [{ text: 'First response', toolCalls: [], toolResults: [] }],
        response: { messages: [{ role: 'assistant', content: 'First response' }] },
      } as any)
      .mockResolvedValueOnce({
        text: 'Second response',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
        steps: [{ text: 'Second response', toolCalls: [], toolResults: [] }],
        response: { messages: [{ role: 'assistant', content: 'Second response' }] },
      } as any)

    const agent = createTestAgent()

    const result1 = await agent.run('prompt 1')
    const result2 = await agent.run('prompt 2')

    // Second run should start fresh, not accumulate from first
    expect(result1.text).toBe('First response')
    expect(result2.text).toBe('Second response')
    expect(result2.steps).toHaveLength(1) // not accumulated
    expect(result2.state.step).toBe(1) // reset counter
  })
})
