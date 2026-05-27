import { generateText, streamText, type CoreMessage, type Tool } from 'ai'
import { z } from 'zod'
import { ToolRegistry, ToolEngine } from '@agentnova/tools'
import type { ToolDefinition, ToolCall, ToolResult, ToolContext } from '@agentnova/tools'
import { PermissionGuard, DEFAULT_PERMISSION_CONFIG, DEFAULT_LIMITS } from '@agentnova/permission'
import type { PermissionConfig, ResourceLimits, ApprovalRequest } from '@agentnova/permission'
import { ProviderRouter } from '@agentnova/providers'
import { ContextManager, DEFAULT_CONTEXT_CONFIG } from './context.js'
import { UsageTracker, getPricing, ResourceLimitError, type UsageSnapshot } from './usage.js'
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
  private usage: UsageTracker

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

    this.registry = new ToolRegistry()
    this.registry.registerAll(config.tools)
    this.engine = new ToolEngine(this.registry)

    this.permissions = {
      ...DEFAULT_PERMISSION_CONFIG,
      ...config.permissions,
      limits: { ...DEFAULT_LIMITS, ...config.permissions?.limits },
    }
    this.guard = new PermissionGuard(this.permissions)

    this.router = config.router

    this.contextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config.context }
    this.contextMgr = new ContextManager(this.contextConfig, this.router)

    this.limits = { ...DEFAULT_LIMITS, ...this.permissions.limits }

    const provider = this.router.getDefault()
    this.usage = new UsageTracker(getPricing(provider.id), this.limits)

    this.state = this.createInitialState()
    this.messages = [{ role: 'system', content: this.systemPrompt }]
  }

  private createInitialState(): AgentState {
    return {
      step: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      startTime: Date.now(),
      toolCallCount: 0,
      aborted: false,
      messages: [],
    }
  }

  // ─── Public API ──────────────────────────────────────────────────

  /** Run the agent with a user prompt (non-streaming) */
  async run(prompt: string, options?: AgentRunOptions): Promise<AgentResult> {
    this.resetState()
    this.messages.push({ role: 'user', content: prompt })
    this.emit('agent:start', { prompt })
    await this.runHook('onStart', { agentState: this.state, step: 0 })

    const signal = options?.signal
    const maxSteps = options?.maxSteps ?? this.limits.maxSteps

    try {
      while (this.state.step < maxSteps) {
        if (signal?.aborted || this.state.aborted) { this.state.aborted = true; break }
        const limitCheck = this.usage.isLimitExceeded()
        if (limitCheck.exceeded) { this.emit('agent:error', { error: limitCheck.reason, step: this.state.step }); break }
        if (this.contextMgr.needsCompression(this.messages)) {
          this.messages = await this.contextMgr.compress(this.messages)
          this.emit('context:compressed', { step: this.state.step })
        }
        const shouldContinue = await this.executeStep(options)
        if (!shouldContinue) break
      }
      return this.buildResult()
    } catch (err) {
      if (err instanceof ResourceLimitError) {
        this.emit('agent:error', { error: err.message, step: this.state.step })
        return this.buildResult()
      }
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit('agent:error', { error: error.message, step: this.state.step })
      await this.runHook('onError', { agentState: this.state, step: this.state.step })
      throw error
    }
  }

  /** Run the agent with streaming output */
  async runStream(prompt: string, options?: AgentRunOptions): Promise<AgentResult> {
    this.resetState()
    this.messages.push({ role: 'user', content: prompt })
    this.emit('agent:start', { prompt })

    const signal = options?.signal
    const maxSteps = options?.maxSteps ?? this.limits.maxSteps

    try {
      while (this.state.step < maxSteps) {
        if (signal?.aborted || this.state.aborted) { this.state.aborted = true; break }
        const limitCheck = this.usage.isLimitExceeded()
        if (limitCheck.exceeded) { this.emit('agent:error', { error: limitCheck.reason, step: this.state.step }); break }
        if (this.contextMgr.needsCompression(this.messages)) {
          this.messages = await this.contextMgr.compress(this.messages)
          this.emit('context:compressed', { step: this.state.step })
        }
        const shouldContinue = await this.executeStepStreaming(options)
        if (!shouldContinue) break
      }
      return this.buildResult()
    } catch (err) {
      if (err instanceof ResourceLimitError) { return this.buildResult() }
      throw err
    }
  }

  registerTool(tool: ToolDefinition): void { this.registry.register(tool) }

  hook(name: HookName, fn: HookFn): void {
    if (!this.hooks.has(name)) this.hooks.set(name, [])
    this.hooks.get(name)!.push(fn)
  }

  on(event: AgentEventName, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, [])
    this.eventHandlers.get(event)!.push(handler)
  }

  getState(): Readonly<AgentState> { return { ...this.state } }

  getUsage(): UsageSnapshot { return this.usage.snapshot() }

  abort(): void { this.state.aborted = true }

  // ─── Step Execution ──────────────────────────────────────────────

  private async executeStep(options?: AgentRunOptions): Promise<boolean> {
    const aiTools = this.buildAITools()
    await this.runHook('onBeforeLLMCall', { agentState: this.state, step: this.state.step, messages: this.messages })
    this.emit('llm:call', { step: this.state.step, messageCount: this.messages.length })
    const provider = this.router.getDefault()
    const stepStart = Date.now()

    const result = await generateText({
      model: provider.model,
      system: this.systemPrompt,
      messages: this.messages.slice(1),
      tools: aiTools,
      abortSignal: options?.signal,
    })

    return this.processStepResult(result.text, result.toolCalls, result.usage, stepStart, options)
  }

  private async executeStepStreaming(options?: AgentRunOptions): Promise<boolean> {
    const aiTools = this.buildAITools()
    await this.runHook('onBeforeLLMCall', { agentState: this.state, step: this.state.step, messages: this.messages })
    this.emit('llm:call', { step: this.state.step, messageCount: this.messages.length })
    const provider = this.router.getDefault()
    const stepStart = Date.now()

    const stream = streamText({
      model: provider.model,
      system: this.systemPrompt,
      messages: this.messages.slice(1),
      tools: aiTools,
      abortSignal: options?.signal,
    })

    let fullText = ''
    for await (const chunk of (await stream).textStream) {
      fullText += chunk
      if (options?.onText) options.onText(chunk)
    }

    const finalResult = await (await stream)
    const finalText = typeof finalResult.text === 'string' ? finalResult.text : fullText
    const finalToolCalls = Array.isArray(finalResult.toolCalls) ? finalResult.toolCalls : []
    return this.processStepResult(
      finalText || undefined,
      finalToolCalls,
      finalResult.usage,
      stepStart,
      options,
    )
  }

  private async processStepResult(
    text: string | undefined,
    toolCalls: any[] | undefined,
    usage: any,
    stepStart: number,
    options?: AgentRunOptions,
  ): Promise<boolean> {
    const stepDuration = Date.now() - stepStart

    if (usage) {
      this.usage.recordTokens(usage.promptTokens ?? 0, usage.completionTokens ?? 0)
      this.state.totalTokensUsed = this.usage.totalTokens
      this.state.totalCost = this.usage.estimatedCost
    }

    await this.runHook('onAfterLLMCall', { agentState: this.state, step: this.state.step, messages: this.messages })
    this.emit('llm:response', { step: this.state.step, tokensUsed: usage?.totalTokens })

    const stepInfo: StepInfo = {
      step: this.state.step,
      text: text || undefined,
      durationMs: stepDuration,
      tokensUsed: usage ? { input: usage.promptTokens ?? 0, output: usage.completionTokens ?? 0 } : undefined,
    }

    if (toolCalls && toolCalls.length > 0) {
      const toolResults: ToolResult[] = []
      stepInfo.toolCalls = toolCalls.map(tc => ({ tool: tc.toolName, args: tc.args as Record<string, unknown> }))

      for (const tc of toolCalls) {
        const call: ToolCall = { tool: tc.toolName, args: tc.args as Record<string, unknown> }
        const tr = await this.executeToolCall(call, options?.signal)
        toolResults.push(tr)
      }

      stepInfo.toolResults = toolResults
      this.messages.push({ role: 'assistant', content: text ?? '' })
      for (const tr of toolResults) {
        this.messages.push({
          role: 'user',
          content: `[Tool: ${tr.tool}] ${tr.error ? `Error: ${tr.error}` : JSON.stringify(tr.output)}`,
        } as CoreMessage)
      }
    } else {
      if (text) this.messages.push({ role: 'assistant', content: text })
    }

    this.steps.push(stepInfo)
    this.usage.recordStep()
    this.state.step++
    if (options?.onStep) options.onStep(stepInfo)
    this.emit('step', { step: this.state.step })

    return !!(toolCalls?.length)
  }

  private async executeToolCall(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    const toolDef = this.registry.get(call.tool)
    const approvalRequest: ApprovalRequest = {
      tool: call.tool,
      args: call.args,
      permission: toolDef?.permission ?? { level: 'dangerous' as const },
    }

    const approval = await this.guard.check(approvalRequest)
    if (approval === 'deny') {
      this.emit('tool:denied', { tool: call.tool, args: call.args })
      return { tool: call.tool, output: null, error: `Permission denied for "${call.tool}"`, durationMs: 0, approved: false }
    }

    this.emit('tool:approved', { tool: call.tool, args: call.args, approval })
    const preHookResult = await this.runHook('onBeforeToolCall', { agentState: this.state, step: this.state.step, toolCall: call })
    if (preHookResult?.action === 'deny') {
      return { tool: call.tool, output: null, error: preHookResult.reason ?? 'Blocked by hook', durationMs: 0, approved: false }
    }

    this.emit('tool:call', { tool: call.tool, args: call.args })
    this.usage.recordToolCall()
    this.state.toolCallCount++

    const toolCtx = createToolContext(
      this.getSnapshot(), this.workingDir,
      signal ?? new AbortController().signal,
      (req: ApprovalRequest) => this.guard.check(req),
    )

    const toolResult = await this.engine.execute(call, toolCtx)
    if (toolResult.output) toolResult.output = this.contextMgr.truncateToolOutput(toolResult.output)
    this.emit('tool:result', { tool: call.tool, result: toolResult })

    await this.runHook('onAfterToolCall', { agentState: this.state, step: this.state.step, toolCall: call, toolResult })
    return toolResult
  }

  // ─── Build Result ────────────────────────────────────────────────

  private buildResult(): AgentResult {
    const finalText = this.extractFinalText()
    this.runHook('onEnd', { agentState: this.state, step: this.state.step })  // fire and forget
    this.emit('agent:end', { steps: this.state.step, durationMs: this.usage.elapsedMs, totalCost: this.usage.estimatedCost })

    return {
      text: finalText,
      messages: this.messages,
      state: { ...this.state, messages: this.messages },
      steps: this.steps,
      totalDurationMs: this.usage.elapsedMs,
      usage: this.usage.snapshot(),
    }
  }

  private resetState(): void {
    this.state = this.createInitialState()
    this.steps = []
    this.messages = [{ role: 'system', content: this.systemPrompt }]
    this.usage.reset()
    this.guard.resetAllowAlways()
    this.contextMgr.adaptToProvider()
  }

  // ─── Private Helpers ─────────────────────────────────────────────

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

  private async runHook(name: HookName, ctx: HookContext): Promise<void | { action?: 'deny'; reason?: string }> {
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
    for (const handler of this.eventHandlers.get(type) ?? []) {
      try { handler(event) } catch { /* swallow */ }
    }
  }

  private getSnapshot() {
    return { step: this.state.step, totalTokensUsed: this.state.totalTokensUsed, startTime: this.state.startTime }
  }

  private extractFinalText(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        const c = this.messages[i].content
        return typeof c === 'string' ? c : ''
      }
    }
    return ''
  }
}

export function createAgent(config: AgentConfig): Agent { return new Agent(config) }
