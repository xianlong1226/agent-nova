import { generateText, streamText, type CoreMessage, type Tool } from 'ai'
import { z } from 'zod'
import { ToolRegistry, ToolEngine } from '@agentnova/tools'
import type { ToolDefinition, ToolCall, ToolResult } from '@agentnova/tools'
import { PermissionGuard, DEFAULT_PERMISSION_CONFIG, DEFAULT_LIMITS } from '@agentnova/permission'
import type { PermissionConfig, ResourceLimits, ApprovalRequest } from '@agentnova/permission'
import { ProviderRouter } from '@agentnova/providers'
import { ContextManager, DEFAULT_CONTEXT_CONFIG } from './context.js'
import { UsageTracker, getPricing, ResourceLimitError, type UsageSnapshot } from './usage.js'
import { createToolContext } from './logger.js'
import { TraceCollector, TraceReplay, StructuredLogger, type Trace, type TraceEntry } from './trace.js'
import { WorkingMemory, ProjectMemory, MemoryInjector, LongTermMemory } from '@agentnova/memory'
import type { LongTermMemoryConfig } from '@agentnova/memory'
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
  private tracer: TraceCollector
  private logger: StructuredLogger

  private systemPrompt: string
  private workingDir: string
  private permissions: PermissionConfig
  private limits: ResourceLimits
  private contextConfig: ContextConfig

  private state: AgentState
  private messages: CoreMessage[] = []

  // Memory
  private workingMemory: WorkingMemory
  private projectMemory: ProjectMemory
  private longTermMemory?: LongTermMemory
  private memoryInjector: MemoryInjector

  // Skills
  private skills: SkillLoaderWorker
  private skillDirs: string[]

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

    this.tracer = new TraceCollector(provider.id)
    this.logger = new StructuredLogger({ traceId: this.tracer['traceId'] })

    // Init memory
    this.workingMemory = new WorkingMemory()
    this.projectMemory = new ProjectMemory(this.workingDir)
    this.projectMemory.load() // fire and forget
    if (config.longTermMemory) {
      this.longTermMemory = new LongTermMemory(config.longTermMemory)
    }
    this.memoryInjector = new MemoryInjector(
      this.workingMemory,
      this.projectMemory,
      this.longTermMemory,
    )

    // Init skills
    this.skills = new SkillLoaderWorker()
    this.skillDirs = config.skillDirs ?? []
    if (this.skillDirs.length > 0) {
      this.skills.loadAll(this.skillDirs)
    }

    this.state = this.createInitialState()
    this.messages = [{ role: 'system', content: this.systemPrompt }]
  }

  /** Build enriched system prompt with memory and skills context */
  private async buildSystemPrompt(): Promise<string> {
    const parts: string[] = [this.systemPrompt]

    // Project memory
    try {
      const projectItems = await this.projectMemory.list()
      if (projectItems.length > 0) {
        const memories = await this.projectMemory.search('', 20)
        if (memories.length > 0) {
          parts.push('\n## Project Memory')
          for (const m of memories) {
            parts.push(`- ${m.key}: ${m.content}`)
          }
        }
      }
    } catch { /* ignore */ }

    // Skills prompt fragments
    const skillPrompts = this.skills.getActivePrompts()
    if (skillPrompts.length > 0) {
      parts.push('\n## Active Skills')
      for (const p of skillPrompts) {
        parts.push(p)
      }
    }

    return parts.join('\n')
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
    await this.resetState(prompt)
    this.emit('agent:start', { prompt })
    await this.runHook('onStart', { agentState: this.state, step: 0 })

    const signal = options?.signal
    const maxSteps = options?.maxSteps ?? this.limits.maxSteps

    try {
      while (this.state.step < maxSteps) {
        if (signal?.aborted || this.state.aborted) { this.state.aborted = true; break }
        const limitCheck = this.usage.isLimitExceeded()
        if (limitCheck.exceeded) { this.emit('agent:error', { error: limitCheck.reason, step: this.state.step }); break }

        // Inject relevant memories before each LLM call
        await this.injectMemories(prompt)

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
    await this.resetState(prompt)
    this.emit('agent:start', { prompt })

    const signal = options?.signal
    const maxSteps = options?.maxSteps ?? this.limits.maxSteps

    try {
      while (this.state.step < maxSteps) {
        if (signal?.aborted || this.state.aborted) { this.state.aborted = true; break }
        const limitCheck = this.usage.isLimitExceeded()
        if (limitCheck.exceeded) { this.emit('agent:error', { error: limitCheck.reason, step: this.state.step }); break }

        await this.injectMemories(prompt)

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

  /** Get execution trace */
  getTrace(): Trace { return this.tracer.buildTrace(this.steps, this.usage.totalTokens, this.usage.estimatedCost) }

  /** Get trace replay */
  replayTrace(): TraceReplay { return new TraceReplay(this.getTrace()) }

  /** Get structured logger */
  getLogger(): StructuredLogger { return this.logger }

  /** Store a memory item */
  async remember(key: string, content: string, layer?: 'working' | 'project' | 'longterm'): Promise<void> {
    await this.memoryInjector.store(key, content, { layer })
  }

  // ─── Memory Injection ────────────────────────────────────────────

  private async injectMemories(prompt: string): Promise<void> {
    const memoryContext = await this.memoryInjector.inject(prompt, 5)
    if (memoryContext) {
      // Find and update the system message with memory context
      const sysIdx = this.messages.findIndex(m => typeof m.content === 'string' && m.content.includes('Project Memory'))
      if (sysIdx >= 0) {
        // Already has memory injected, update it
        // For simplicity, we inject as a system message after the first one
      } else {
        // Inject as a user-like context message
        this.messages.splice(1, 0, { role: 'system', content: memoryContext })
      }
    }

    // Activate skills based on prompt
    const active = this.skills.activateForInput(prompt)
    if (active.length > 0) {
      const skillTools = this.skills.getActiveTools()
      for (const tool of skillTools) {
        if (!this.registry.has(tool.name)) {
          this.registry.register(tool)
        }
      }
      this.emit('skill:activated', { skills: active.map(s => s.name) })
    }
  }

  // ─── Step Execution ──────────────────────────────────────────────

  private async executeStep(options?: AgentRunOptions): Promise<boolean> {
    const aiTools = this.buildAITools()
    await this.runHook('onBeforeLLMCall', { agentState: this.state, step: this.state.step, messages: this.messages })
    this.emit('llm:call', { step: this.state.step, messageCount: this.messages.length })
    const stepStart = Date.now()

    // Try providers with fallback chain
    const fallbackChain = this.router.getFallbackChain()
    let lastError: Error | undefined

    for (const provider of fallbackChain) {
      try {
        const result = await generateText({
          model: provider.model,
          system: this.systemPrompt,
          messages: this.messages.slice(1),
          tools: aiTools,
          abortSignal: options?.signal,
        })
        return this.processStepResult(result.text, result.toolCalls, result.usage, stepStart, options)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (!this.router.shouldFallback(err)) throw lastError
        this.emit('provider:fallback', { from: provider.id, error: lastError.message, step: this.state.step })
      }
    }

    throw lastError ?? new Error('All providers failed')
  }

  private async executeStepStreaming(options?: AgentRunOptions): Promise<boolean> {
    const aiTools = this.buildAITools()
    await this.runHook('onBeforeLLMCall', { agentState: this.state, step: this.state.step, messages: this.messages })
    this.emit('llm:call', { step: this.state.step, messageCount: this.messages.length })
    const stepStart = Date.now()

    // Try providers with fallback chain
    const fallbackChain = this.router.getFallbackChain()
    let lastError: Error | undefined

    for (const provider of fallbackChain) {
      try {
        const streamResults = streamText({
          model: provider.model,
          system: this.systemPrompt,
          messages: this.messages.slice(1),
          tools: aiTools,
          abortSignal: options?.signal,
        })

        const consumed = await streamResults
        let fullText = ''
        for await (const chunk of consumed.textStream) {
          fullText += chunk
          if (options?.onText) options.onText(chunk)
        }

        const finalText = typeof consumed.text === 'string' ? consumed.text : fullText
        const finalToolCalls = Array.isArray(consumed.toolCalls) ? consumed.toolCalls : []
        return this.processStepResult(
          finalText || undefined,
          finalToolCalls,
          consumed.usage,
          stepStart,
          options,
        )
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (!this.router.shouldFallback(err)) throw lastError
        this.emit('provider:fallback', { from: provider.id, error: lastError.message, step: this.state.step })
      }
    }

    throw lastError ?? new Error('All providers failed')
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
    this.runHook('onEnd', { agentState: this.state, step: this.state.step })
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

  private async resetState(prompt: string): Promise<void> {
    this.state = this.createInitialState()
    this.steps = []
    this.messages = [{ role: 'system', content: await this.buildSystemPrompt() }]
    this.messages.push({ role: 'user', content: prompt })
    this.usage.reset()
    this.guard.resetAllowAlways()
    this.contextMgr.adaptToProvider()
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  private buildAITools(): Record<string, Tool> {
    // Merge built-in tools + skill tools
    const allTools = [
      ...this.registry.getAll(),
      ...this.skills.getActiveTools(),
    ]

    const tools: Record<string, Tool> = {}
    for (const toolDef of allTools) {
      if (!tools[toolDef.name]) {
        tools[toolDef.name] = {
          description: toolDef.description,
          parameters: toolDef.parameters as z.ZodTypeAny,
          execute: async (args: unknown) => args,
        }
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
    // Record to trace collector
    const traceTypeMap: Partial<Record<AgentEventName, TraceEntry['type']>> = {
      'step': 'step',
      'tool:call': 'tool_call',
      'tool:result': 'tool_result',
      'llm:call': 'llm_call',
      'context:compressed': 'compression',
      'skill:activated': 'skill',
      'skill:deactivated': 'skill',
      'provider:fallback': 'provider_fallback',
    }
    const tracedType = traceTypeMap[type]
    if (tracedType) this.tracer.record(tracedType, data)

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

// ─── Skill Loader Worker (lightweight wrapper) ─────────────────────

class SkillLoaderWorker {
  private skills: Array<{ name: string; tools: ToolDefinition[]; prompt: string; active: boolean; activateOn?: (input: string) => boolean }> = []

  async loadAll(dirs: string[]) {
    const { SkillLoader } = await import('@agentnova/skills')
    const loader = new SkillLoader()
    const loaded = await loader.loadAll(dirs)
    this.skills = loaded.map(s => ({
      name: s.name,
      tools: s.tools ?? [],
      prompt: s.prompt ?? '',
      active: s.active,
      activateOn: s.activateOn,
    }))
  }

  activateForInput(input: string): Array<{ name: string; active: boolean }> {
    const active: Array<{ name: string; active: boolean }> = []
    for (const skill of this.skills) {
      if (skill.activateOn) {
        if (skill.activateOn(input)) {
          if (!skill.active) {
            skill.active = true
            active.push(skill)
          }
        }
      }
    }
    return active
  }

  getActiveTools(): ToolDefinition[] {
    return this.skills.filter(s => s.active).flatMap(s => s.tools)
  }

  getActivePrompts(): string[] {
    return this.skills.filter(s => s.active && s.prompt).map(s => s.prompt)
  }
}

// Re-export types
export type { UsageSnapshot } from './usage.js'
