import type { ToolDefinition, ToolCall, ToolResult, ToolContext } from './types.js'

// ─── Tool Registry ─────────────────────────────────────────────────

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  /** Register a tool definition */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  /** Register multiple tools at once */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }

  /** Get a tool by name */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /** List all registered tool names */
  list(): string[] {
    return Array.from(this.tools.keys())
  }

  /** Get all registered tools */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /** Get tool definitions formatted for LLM consumption */
  getToolSchemas(): Record<string, { description: string; parameters: unknown }> {
    const schemas: Record<string, { description: string; parameters: unknown }> = {}
    for (const tool of this.tools.values()) {
      schemas[tool.name] = {
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      }
    }
    return schemas
  }

  /** Unregister a tool */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /** Clear all tools */
  clear(): void {
    this.tools.clear()
  }
}

// ─── Tool Engine ───────────────────────────────────────────────────

export class ToolEngine {
  constructor(private registry: ToolRegistry) {}

  /** Execute a tool call with context */
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.registry.get(call.tool)

    if (!tool) {
      return {
        tool: call.tool,
        output: null,
        error: `Unknown tool: "${call.tool}". Available tools: ${this.registry.list().join(', ')}`,
        durationMs: 0,
        approved: false,
      }
    }

    const start = Date.now()

    try {
      // Validate input against Zod schema
      const parsed = tool.parameters.safeParse(call.args)
      if (!parsed.success) {
        return {
          tool: call.tool,
          output: null,
          error: `Invalid input for "${call.tool}": ${parsed.error.message}`,
          durationMs: Date.now() - start,
          approved: false,
        }
      }

      // Execute
      const result = await tool.execute(parsed.data, ctx)

      return {
        tool: call.tool,
        output: result,
        durationMs: Date.now() - start,
        approved: true,
      }
    } catch (err) {
      return {
        tool: call.tool,
        output: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        approved: true,
      }
    }
  }

  /** Get the underlying registry */
  getRegistry(): ToolRegistry {
    return this.registry
  }
}

// ─── Zod → JSON Schema (minimal) ──────────────────────────────────

function zodToJsonSchema(schema: unknown): unknown {
  // Vercel AI SDK handles Zod schemas natively via tool({ parameters: z.object(...) })
  // This is a simplified adapter for potential non-AI-SDK consumers
  if (schema && typeof schema === 'object' && '_def' in (schema as object)) {
    // Return as-is for AI SDK consumption — it handles Zod natively
    return schema
  }
  return schema
}
