import { generateText, type CoreMessage, type Tool } from 'ai'
import { z } from 'zod'
import { ToolRegistry, ToolEngine } from '@agentnova/tools'
import type { ToolDefinition, ToolCall, ToolResult, ToolContext } from '@agentnova/tools'
import { PermissionGuard, DEFAULT_PERMISSION_CONFIG, DEFAULT_LIMITS } from '@agentnova/permission'
import type { PermissionConfig, ResourceLimits, ApprovalRequest, ApprovalResult } from '@agentnova/permission'
import { ProviderRouter } from '@agentnova/providers'
import { ContextManager, DEFAULT_CONTEXT_CONFIG } from './context.js'
import { createToolContext } from './logger.js'
import type {
  AgentConfig,
  AgentState,
  AgentRunOptions,
  AgentResult,
  StepInfo,
  AgentEvent,
  AgentEventName,
  EventHandler,
  HookName,
  HookFn,
  HookContext,
  ContextConfig,
} from './types.js'

// ─── Agent Class ───────────────────────────────────────────────────

export class Agent {
  private registry: ToolRegistry
  private engine: ToolEngine
  private guard: PermissionGuard
  private router: ProviderRouter
  private contextMgr: ContextManager

  private systemPrompt: string
  private workingDir: string
  private permissions: PermissionConfig
  private limits: ResourceLimits
  private contextConfig: ContextConfig

  private state: AgentState
  private messages: CoreMessage[] = []

  private hooks: Map<HookName, HookFn[]> = new Map()
  private eventHandlers: Map<AgentEventName, EventHandler[]> = new Map()
  private steps: StepInfo[] = []

  constructor(config: AgentConfig) {
    this.systemPrompt = config.systemPrompt
    this.workingDir = config.workingDir

    // Tools
    this.registry = new ToolRegistry()
    this.registry.registerAll(config.tools)
    this.engine = new ToolEngine(this.registry)

    // Permissions
    this.permissions = {
      ...DEFAULT_PERMISSION_CONFIG,
      ...config.permissions,
      limits: { ...DEFAULT_LIMITS, ...config.permissions?.limits },
    }
    this.guard = new PermissionGuard(this.permissions)

    // Provider
    this.router = config.router

    // Context
    this.contextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config.context }
    this.contextMgr = new ContextManager(this.contextConfig, this.router)

    // Limits
    this.limits = { ...DEFAULT_LIMITS, ...this.permissions.limits }

    // Init state
    this.state = {
      step: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      startTime: Date.now(),
      toolCallCount: 0,
      aborted: false,
      messages: [],
    }

    this.messages = [{ role: 'system', content: this.systemPrompt }]
  }

  // ─── Public API ──────────────────────────────────────────────────

  async run(prompt: string, options?: AgentRunOptions): Promise<AgentResult> {
    // Reset state
    this.state = {
      step: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      startTime: Date.now(),
      toolCallCount: 0,
      aborted: false,
      messages: [{ role: 'system', content: this.systemPrompt }],
    }
    this.steps = []
    this.messages.push({ role: 'user', content: prompt })

    this.emit('agent:start', { prompt })
    await this.runHook('onStart', { agentState: this.state, step: 0 })

    const maxSteps = options?.maxSteps ?? this.limits.maxSteps
    const signal = options?.signal
    const runStart = Date.now()

    try {
      while (this.state.step < maxSteps) {
        if (signal?.aborted || this.state.aborted) {
          this.state.aborted = true
          break
        }

        // Check limits
        if (this.state.totalTokensUsed >= this.limits.maxTokens) break
        if (this.state.toolCallCount >= this.limits.maxToolCalls) break
        if (Date.now() - this.state.startTime >= this.limits.timeoutMs) break

        // Context compression
        if (this.contextMgr.needsCompression(this.messages)) {
          this.messages = await this.contextMgr.compress(this.messages)
          this.emit('context:compressed', { step: this.state.step })
        }

        // Build AI SDK tools
        const aiTools = this.buildAITools()

        // Hook: onBeforeLLMCall
        await this.runHook('onBeforeLLMCall', {
          agentState: this.state,
          step: this.state.step,
          messages: this.messages,
        })

        // Call LLM
        this.emit('llm:call', { step: this.state.step, messageCount: this.messages.length })
        const provider = this.router.getDefault()

        const stepStart = Date.now()
        const result = await generateText({
          model: provider.model,
          system: this.systemPrompt,
          messages: this.messages.slice(1),
          tools: aiTools,
          abortSignal: signal,
        })

        const stepDuration = Date.now() - stepStart

        if (result.usage) {
          this.state.totalTokensUsed += result.usage.totalTokens ?? 0
        }

        await this.runHook('onAfterLLMCall', {
          agentState: this.state,
          step: this.state.step,
          messages: this.messages,
        })

        this.emit('llm:response', { step: this.state.step, tokensUsed: result.usage?.totalTokens })

        const stepInfo: StepInfo = {
          step: this.state.step,
          text: result.text || undefined,
          durationMs: stepDuration,
        }

        if (result.text && options?.onText) {
          options.onText(result.text)
        }

        // Handle tool calls
        if (result.toolCalls && result.toolCalls.length > 0) {
          const toolResults: ToolResult[] = []

          stepInfo.toolCalls = result.toolCalls.map(tc => ({
            tool: tc.toolName,
            args: tc.args as Record<string, unknown>,
          }))

          for (const toolCall of result.toolCalls) {
            const call: ToolCall = {
              tool: toolCall.toolName,
              args: toolCall.args as Record<string, unknown>,
            }

            // Permission check
            const toolDef = this.registry.get(toolCall.toolName)
            const approvalRequest: ApprovalRequest = {
              tool: toolCall.toolName,
              args: call.args,
              permission: toolDef?.permission ?? { level: 'dangerous' as const },
            }

            const approval = await this.guard.check(approvalRequest)

            if (approval === 'deny') {
              this.emit('tool:denied', { tool: toolCall.toolName, args: call.args })
              toolResults.push({
                tool: toolCall.toolName,
                output: null,
                error: `Permission denied for tool "${toolCall.toolName}"`,
                durationMs: 0,
                approved: false,
              })
              continue
            }

            this.emit('tool:approved', { tool: toolCall.toolName, args: call.args, approval })

            // Hook: onBeforeToolCall
            const preHookCtx: HookContext = {
              agentState: this.state,
              step: this.state.step,
              toolCall: call,
            }
            const preHookResult = await this.runHook('onBeforeToolCall', preHookCtx)
            if (preHookResult?.action === 'deny') {
              toolResults.push({
                tool: toolCall.toolName,
                output: null,
                error: preHookResult.reason ?? 'Blocked by hook',
                durationMs: 0,
                approved: false,
              })
              continue
            }

            // Execute tool
            this.emit('tool:call', { tool: toolCall.toolName, args: call.args })
            this.state.toolCallCount++

            const toolCtx = createToolContext(
              this.getSnapshot(),
              this.workingDir,
              signal ?? new AbortController().signal,
              (req: ApprovalRequest) => this.guard.check(req),
            )

            const toolResult = await this.engine.execute(call, toolCtx)

            if (toolResult.output) {
              toolResult.output = this.contextMgr.truncateToolOutput(toolResult.output)
            }

            toolResults.push(toolResult)
            this.emit('tool:result', { tool: toolCall.toolName, result: toolResult })

            await this.runHook('onAfterToolCall', {
              agentState: this.state,
              step: this.state.step,
              toolCall: call,
              toolResult,
            })
          }

          stepInfo.toolResults = toolResults

          // Add assistant + tool messages to history
          this.messages.push({ role: 'assistant', content: result.text ?? '' })

          for (const tr of toolResults) {
            // Use user message as a workaround for tool result injection
            this.messages.push({
              role: 'user',
              content: `[Tool: ${tr.tool}] ${tr.error ? `Error: ${tr.error}` : JSON.stringify(tr.output)}`,
            } as CoreMessage)
          }
        } else {
          if (result.text) {
            this.messages.push({ role: 'assistant', content: result.text })
          }
        }

        this.steps.push(stepInfo)
        this.state.step++

        if (options?.onStep) {
          options.onStep(stepInfo)
        }

        this.emit('step', { step: this.state.step })

        // No tool calls + text = agent is done
        if (!result.toolCalls?.length && result.text) {
          break
        }
      }

      const finalText = this.extractFinalText()
      const agentResult: AgentResult = {
        text: finalText,
        messages: this.messages,
        state: { ...this.state, messages: this.messages },
        steps: this.steps,
        totalDurationMs: Date.now() - runStart,
      }

      await this.runHook('onEnd', { agentState: this.state, step: this.state.step })
      this.emit('agent:end', { steps: this.state.step, durationMs: agentResult.totalDurationMs })

      return agentResult
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit('agent:error', { error: error.message, step: this.state.step })
      await this.runHook('onError', { agentState: this.state, step: this.state.step })
      throw error
    }
  }

  registerTool(tool: ToolDefinition): void {
    this.registry.register(tool)
  }

  hook(name: HookName, fn: HookFn): void {
    if (!this.hooks.has(name)) this.hooks.set(name, [])
    this.hooks.get(name)!.push(fn)
  }

  on(event: AgentEventName, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, [])
    this.eventHandlers.get(event)!.push(handler)
  }

  getState(): Readonly<AgentState> {
    return { ...this.state }
  }

  // ─── Private ─────────────────────────────────────────────────────

  private buildAITools(): Record<string, Tool> {
    const tools: Record<string, Tool> = {}
    for (const toolDef of this.registry.getAll()) {
      tools[toolDef.name] = {
        description: toolDef.description,
        parameters: toolDef.parameters as z.ZodTypeAny,
        execute: async (args: unknown) => args,
      }
    }
    return tools
  }

  private async runHook(
    name: HookName,
    ctx: HookContext,
  ): Promise<void | { action?: 'deny'; reason?: string }> {
    const fns = this.hooks.get(name) ?? []
    let result: void | { action?: 'deny'; reason?: string } | undefined
    for (const fn of fns) {
      result = await fn(ctx)
      if (result?.action === 'deny') return result
    }
    return result
  }

  private emit(type: AgentEventName, data: Record<string, unknown>): void {
    const event: AgentEvent = { type, timestamp: Date.now(), data }
    const handlers = this.eventHandlers.get(type) ?? []
    for (const handler of handlers) {
      try { handler(event) } catch { /* swallow */ }
    }
  }

  private getSnapshot() {
    return {
      step: this.state.step,
      totalTokensUsed: this.state.totalTokensUsed,
      startTime: this.state.startTime,
    }
  }

  private extractFinalText(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        const content = this.messages[i].content
        return typeof content === 'string' ? content : ''
      }
    }
    return ''
  }
}

// ─── Factory ───────────────────────────────────────────────────────

export function createAgent(config: AgentConfig): Agent {
  return new Agent(config)
}
