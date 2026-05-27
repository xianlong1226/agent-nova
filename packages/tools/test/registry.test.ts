import { describe, it, expect } from 'vitest'
import { ToolRegistry, ToolEngine } from '../src/registry.js'
import { defineTool } from '../src/types.js'
import { z } from 'zod'

const mockTool = defineTool({
  name: 'test.echo',
  description: 'Echo back the input',
  parameters: z.object({ message: z.string() }),
  permission: { level: 'read' },
  execute: async ({ message }) => ({ echoed: message }),
})

const mockContext = {
  agentState: { step: 0, totalTokensUsed: 0, startTime: Date.now() },
  workingDir: '/tmp',
  abortSignal: new AbortController().signal,
  askApproval: async () => 'allow-once' as const,
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}

describe('ToolRegistry', () => {
  it('should register and retrieve a tool', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool)
    expect(registry.has('test.echo')).toBe(true)
    expect(registry.get('test.echo')?.name).toBe('test.echo')
  })

  it('should throw on duplicate registration', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool)
    expect(() => registry.register(mockTool)).toThrow('already registered')
  })

  it('should list all tools', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool)
    expect(registry.list()).toEqual(['test.echo'])
  })

  it('should unregister a tool', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool)
    expect(registry.unregister('test.echo')).toBe(true)
    expect(registry.has('test.echo')).toBe(false)
  })
})

describe('ToolEngine', () => {
  it('should execute a valid tool call', async () => {
    const registry = new ToolRegistry()
    registry.register(mockTool)
    const engine = new ToolEngine(registry)

    const result = await engine.execute(
      { tool: 'test.echo', args: { message: 'hello' } },
      mockContext,
    )

    expect(result.tool).toBe('test.echo')
    expect(result.output).toEqual({ echoed: 'hello' })
    expect(result.error).toBeUndefined()
    expect(result.approved).toBe(true)
  })

  it('should return error for unknown tool', async () => {
    const registry = new ToolRegistry()
    const engine = new ToolEngine(registry)

    const result = await engine.execute(
      { tool: 'nonexistent', args: {} },
      mockContext,
    )

    expect(result.error).toContain('Unknown tool')
    expect(result.approved).toBe(false)
  })

  it('should validate input against schema', async () => {
    const registry = new ToolRegistry()
    registry.register(mockTool)
    const engine = new ToolEngine(registry)

    const result = await engine.execute(
      { tool: 'test.echo', args: { wrong_field: 123 } },
      mockContext,
    )

    expect(result.error).toContain('Invalid input')
    expect(result.approved).toBe(false)
  })
})
