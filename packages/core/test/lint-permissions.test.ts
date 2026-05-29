import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAgent } from '../src/agent.js'
import type { ToolDefinition } from '@agentnova/tools'
import { z } from 'zod'

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('sql.js', () => ({
  default: vi.fn().mockResolvedValue({
    Database: class {
      run() {} ; prepare() { return { bind: () => true, step: () => false, getAsObject: () => ({}), free: () => true } }
      exec() { return [] } ; export() { return new Uint8Array(0) } ; close() {}
    },
  }),
}))

function mockRouter() {
  const provider = { id: 'test', name: 'Test', model: { modelId: 'test' }, contextWindow: 128_000 }
  return {
    getDefault: () => provider,
    get: () => provider,
    getFallbackChain: () => [provider],
    shouldFallback: () => true,
    listProviders: () => ['test'],
  } as any
}

const dangerousTool: ToolDefinition = {
  name: 'shell.exec',
  description: 'shell',
  parameters: z.object({ command: z.string() }),
  permission: { level: 'dangerous' },
  execute: async () => ({}),
}

const readTool: ToolDefinition = {
  name: 'fs.readFile',
  description: 'read',
  parameters: z.object({ path: z.string() }),
  permission: { level: 'read' },
  execute: async () => ({}),
}

describe('Agent.lintPermissions', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  function build(opts: { tools: ToolDefinition[]; rules: { tool: string; mode: 'allow' | 'ask' | 'deny' }[] }) {
    return createAgent({
      systemPrompt: 's',
      workingDir: '/tmp',
      router: mockRouter(),
      tools: opts.tools,
      permissions: {
        mode: 'ask' as const,
        rules: opts.rules,
        limits: { maxSteps: 10, maxTokens: 1000, maxToolCalls: 10, timeoutMs: 1000, maxFileSize: 1000 },
      },
    })
  }

  it('warns when rule references an unknown tool', () => {
    build({ tools: [readTool], rules: [{ tool: 'fs.unknownTypo', mode: 'allow' }] })
    const calls = warn.mock.calls.map((c) => JSON.stringify(c))
    expect(calls.some((s) => s.includes('rule references unknown tool') && s.includes('fs.unknownTypo'))).toBe(true)
  })

  it('warns when a dangerous tool is unconditionally allowed', () => {
    build({ tools: [dangerousTool], rules: [{ tool: 'shell.exec', mode: 'allow' }] })
    const calls = warn.mock.calls.map((c) => JSON.stringify(c))
    expect(calls.some((s) => s.includes('dangerous tool unconditionally allowed') && s.includes('shell.exec'))).toBe(true)
  })

  it('warns when a read-only tool is denied by rule', () => {
    build({ tools: [readTool], rules: [{ tool: 'fs.readFile', mode: 'deny' }] })
    const calls = warn.mock.calls.map((c) => JSON.stringify(c))
    expect(calls.some((s) => s.includes('read-only tool denied by rule') && s.includes('fs.readFile'))).toBe(true)
  })

  it('does not warn for wildcard patterns', () => {
    build({ tools: [readTool], rules: [{ tool: 'fs.*', mode: 'allow' }] })
    const calls = warn.mock.calls.map((c) => JSON.stringify(c))
    expect(calls.some((s) => s.includes('rule references unknown tool'))).toBe(false)
  })
})
