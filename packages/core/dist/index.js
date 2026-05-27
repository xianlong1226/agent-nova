// src/agent.ts
import { generateText, streamText } from "ai";
import { ToolRegistry, ToolEngine } from "@agentnova/tools";
import { PermissionGuard, DEFAULT_PERMISSION_CONFIG, DEFAULT_LIMITS } from "@agentnova/permission";

// src/context.ts
var ContextManager = class {
  constructor(config, router) {
    this.router = router;
    this.config = config;
  }
  router;
  config;
  // ─── Token Estimation ────────────────────────────────────────────
  /**
   * Estimate token count for messages.
   * Uses a heuristic: ~4 chars per token for English, ~2 chars per token for CJK.
   * Falls back to 3.5 chars/token average for mixed content.
   */
  estimateTokens(messages) {
    let total = 0;
    for (const msg of messages) {
      const text = this.extractText(msg);
      total += this.estimateTextTokens(text);
    }
    total += messages.length * 4;
    return total;
  }
  /** Estimate tokens for a single text string */
  estimateTextTokens(text) {
    if (!text) return 0;
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
    const totalChars = text.length;
    const cjkRatio = totalChars > 0 ? cjkChars / totalChars : 0;
    const charsPerToken = cjkRatio > 0.3 ? 2 : 4 - cjkRatio * 2;
    return Math.ceil(totalChars / charsPerToken);
  }
  // ─── Context Window ──────────────────────────────────────────────
  /** Get the context window size for the current default provider */
  getContextWindow() {
    const defaultProvider = this.router.getDefault();
    return defaultProvider.contextWindow ?? 128e3;
  }
  /** Get usable context (reserve space for system prompt + response) */
  getUsableContext() {
    const window = this.getContextWindow();
    return Math.floor(window * 0.8);
  }
  /** Check if compression is needed */
  needsCompression(messages) {
    const tokens = this.estimateTokens(messages);
    const threshold = this.getContextWindow() * this.config.compressionTriggerRatio;
    return tokens > threshold;
  }
  /** Calculate how much we need to compress (0-1) */
  compressionRatio(messages) {
    const tokens = this.estimateTokens(messages);
    const target = this.getUsableContext();
    if (tokens <= target) return 0;
    return Math.min(1 - target / tokens, 0.7);
  }
  // ─── Compression ─────────────────────────────────────────────────
  /**
   * Compress messages if needed.
   * Returns potentially reduced message array.
   */
  async compress(messages, summarizer) {
    if (!this.needsCompression(messages)) return messages;
    const [recent, older] = this.splitMessages(messages, this.config.preserveRecentTurns);
    if (older.length === 0) return recent;
    switch (this.config.compressionStrategy) {
      case "sliding-window":
        return recent;
      case "summary": {
        if (summarizer) {
          const summary = await this.summarizeMessages(older, summarizer);
          return [summary, ...recent];
        }
        return recent;
      }
      case "hybrid":
      default: {
        if (summarizer) {
          const summary = await this.summarizeMessages(older, summarizer);
          return [summary, ...recent];
        }
        const keyMessages = this.extractKeyMessages(older);
        return [...keyMessages, ...recent];
      }
    }
  }
  // ─── Tool Output Handling ────────────────────────────────────────
  /** Truncate a tool output to fit budget */
  truncateToolOutput(output) {
    const str = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    if (str.length <= this.config.maxToolOutputLength) return str;
    if (this.config.toolOutputTruncate === "head") {
      return str.slice(0, this.config.maxToolOutputLength) + "\n... [truncated]";
    }
    return "... [truncated]\n" + str.slice(-this.config.maxToolOutputLength);
  }
  // ─── Message Priorities ──────────────────────────────────────────
  /** Assign priority to a message (higher = more important to keep) */
  messagePriority(msg) {
    if (msg.role === "system") return 100;
    if (msg.role === "user") return 80;
    if (msg.role === "assistant") return 60;
    return 20;
  }
  // ─── Private Helpers ─────────────────────────────────────────────
  /** Split messages at the N-th most recent turn boundary */
  splitMessages(messages, preserveRecent) {
    let turnCount = 0;
    let splitIndex = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        turnCount++;
        if (turnCount > preserveRecent) {
          splitIndex = i;
          break;
        }
      }
    }
    return [messages.slice(splitIndex), messages.slice(0, splitIndex)];
  }
  /** Summarize a block of older messages using LLM */
  async summarizeMessages(messages, summarizer) {
    const text = messages.map((m) => {
      const content = this.extractText(m);
      return `[${m.role}]: ${content}`;
    }).join("\n");
    const summary = await summarizer(text);
    return {
      role: "system",
      content: `[Conversation Summary]
${summary}`
    };
  }
  /** Extract key messages (user + assistant, compress tool results) */
  extractKeyMessages(messages) {
    return messages.map((msg) => {
      const text = this.extractText(msg);
      if (msg.role === "system" || msg.role === "user") return msg;
      if (msg.role === "assistant") {
        return text.trim() ? msg : null;
      }
      return {
        role: "user",
        content: `[Tool Output]: ${this.truncateToolOutput(text)}`
      };
    }).filter(Boolean);
  }
  /** Extract plain text from a message */
  extractText(msg) {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content.map((part) => {
        if (part.type === "text") return part.text;
        if ("text" in part && typeof part.text === "string") return part.text;
        return "";
      }).join("\n");
    }
    return "";
  }
  // ─── Adaptive Window ─────────────────────────────────────────────
  /**
   * Adapt compression settings based on the current provider.
   * Called when the active provider changes.
   */
  adaptToProvider() {
    const window = this.getContextWindow();
    if (window <= 32e3) {
      this.config = { ...this.config, preserveRecentTurns: 5, compressionTriggerRatio: 0.5 };
    } else if (window <= 128e3) {
      this.config = { ...this.config, preserveRecentTurns: 10, compressionTriggerRatio: 0.7 };
    } else {
      this.config = { ...this.config, preserveRecentTurns: 15, compressionTriggerRatio: 0.75 };
    }
  }
};
var DEFAULT_CONTEXT_CONFIG = {
  preserveRecentTurns: 10,
  compressionTriggerRatio: 0.7,
  compressionStrategy: "hybrid",
  maxToolOutputLength: 8e3,
  toolOutputTruncate: "tail"
};

// src/usage.ts
var UsageTracker = class {
  constructor(price, limits) {
    this.price = price;
    this.limits = limits;
    this.startTime = Date.now();
  }
  price;
  limits;
  inputTokens = 0;
  outputTokens = 0;
  toolCallCount = 0;
  stepCount = 0;
  startTime;
  /** Record token usage from an LLM call */
  recordTokens(input, output) {
    this.inputTokens += input;
    this.outputTokens += output;
  }
  /** Record a tool call */
  recordToolCall() {
    this.toolCallCount++;
  }
  /** Record a step completion */
  recordStep() {
    this.stepCount++;
  }
  // ─── Limit Checks ──────────────────────────────────────────────
  /** Check if any limit has been exceeded */
  isLimitExceeded() {
    if (this.stepCount >= this.limits.maxSteps) {
      return { exceeded: true, reason: `Max steps (${this.limits.maxSteps}) reached` };
    }
    if (this.totalTokens >= this.limits.maxTokens) {
      return { exceeded: true, reason: `Max tokens (${this.limits.maxTokens}) reached` };
    }
    if (this.toolCallCount >= this.limits.maxToolCalls) {
      return { exceeded: true, reason: `Max tool calls (${this.limits.maxToolCalls}) reached` };
    }
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.limits.timeoutMs) {
      return { exceeded: true, reason: `Timeout (${this.limits.timeoutMs}ms) reached` };
    }
    return { exceeded: false };
  }
  /** Throw if limit exceeded */
  assertWithinLimits() {
    const check = this.isLimitExceeded();
    if (check.exceeded) {
      throw new ResourceLimitError(check.reason);
    }
  }
  // ─── Getters ───────────────────────────────────────────────────
  get totalTokens() {
    return this.inputTokens + this.outputTokens;
  }
  get estimatedCost() {
    return this.inputTokens / 1e6 * this.price.inputPer1M + this.outputTokens / 1e6 * this.price.outputPer1M;
  }
  get elapsedMs() {
    return Date.now() - this.startTime;
  }
  /** Get a snapshot of current usage */
  snapshot() {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      estimatedCost: this.estimatedCost,
      toolCallCount: this.toolCallCount,
      stepCount: this.stepCount,
      durationMs: this.elapsedMs
    };
  }
  /** Reset tracker (for new runs) */
  reset() {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.toolCallCount = 0;
    this.stepCount = 0;
    this.startTime = Date.now();
  }
};
var ResourceLimitError = class extends Error {
  constructor(reason) {
    super(`Resource limit exceeded: ${reason}`);
    this.name = "ResourceLimitError";
  }
};
var PROVIDER_PRICING = {
  "openai-gpt4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "deepseek-chat": { inputPer1M: 0.14, outputPer1M: 0.28 },
  "deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19 },
  "qwen-max": { inputPer1M: 1.6, outputPer1M: 6.4 },
  "anthropic-sonnet4": { inputPer1M: 3, outputPer1M: 15 },
  "anthropic-haiku35": { inputPer1M: 0.8, outputPer1M: 4 }
};
function getPricing(providerId) {
  return PROVIDER_PRICING[providerId] ?? PROVIDER_PRICING["openai-gpt4o"];
}

// src/logger.ts
var ConsoleToolLogger = class {
  constructor(prefix = "AgentNova") {
    this.prefix = prefix;
  }
  prefix;
  info(message, data) {
    console.log(`[${this.prefix}] INFO: ${message}`, data ?? "");
  }
  warn(message, data) {
    console.warn(`[${this.prefix}] WARN: ${message}`, data ?? "");
  }
  error(message, data) {
    console.error(`[${this.prefix}] ERROR: ${message}`, data ?? "");
  }
};
function createToolContext(state, workingDir, abortSignal, approvalFn) {
  return {
    agentState: state,
    workingDir,
    abortSignal,
    askApproval: approvalFn,
    logger: new ConsoleToolLogger()
  };
}

// src/agent.ts
import { WorkingMemory, ProjectMemory, MemoryInjector, LongTermMemory } from "@agentnova/memory";
var Agent = class {
  registry;
  engine;
  guard;
  router;
  contextMgr;
  usage;
  systemPrompt;
  workingDir;
  permissions;
  limits;
  contextConfig;
  state;
  messages = [];
  // Memory
  workingMemory;
  projectMemory;
  longTermMemory;
  memoryInjector;
  // Skills
  skills;
  skillDirs;
  hooks = /* @__PURE__ */ new Map();
  eventHandlers = /* @__PURE__ */ new Map();
  steps = [];
  constructor(config) {
    this.systemPrompt = config.systemPrompt;
    this.workingDir = config.workingDir;
    this.registry = new ToolRegistry();
    this.registry.registerAll(config.tools);
    this.engine = new ToolEngine(this.registry);
    this.permissions = {
      ...DEFAULT_PERMISSION_CONFIG,
      ...config.permissions,
      limits: { ...DEFAULT_LIMITS, ...config.permissions?.limits }
    };
    this.guard = new PermissionGuard(this.permissions);
    this.router = config.router;
    this.contextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config.context };
    this.contextMgr = new ContextManager(this.contextConfig, this.router);
    this.limits = { ...DEFAULT_LIMITS, ...this.permissions.limits };
    const provider = this.router.getDefault();
    this.usage = new UsageTracker(getPricing(provider.id), this.limits);
    this.workingMemory = new WorkingMemory();
    this.projectMemory = new ProjectMemory(this.workingDir);
    this.projectMemory.load();
    if (config.longTermMemory) {
      this.longTermMemory = new LongTermMemory(config.longTermMemory);
    }
    this.memoryInjector = new MemoryInjector(
      this.workingMemory,
      this.projectMemory,
      this.longTermMemory
    );
    this.skills = new SkillLoaderWorker();
    this.skillDirs = config.skillDirs ?? [];
    if (this.skillDirs.length > 0) {
      this.skills.loadAll(this.skillDirs);
    }
    this.state = this.createInitialState();
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }
  /** Build enriched system prompt with memory and skills context */
  async buildSystemPrompt() {
    const parts = [this.systemPrompt];
    try {
      const projectItems = await this.projectMemory.list();
      if (projectItems.length > 0) {
        const memories = await this.projectMemory.search("", 20);
        if (memories.length > 0) {
          parts.push("\n## Project Memory");
          for (const m of memories) {
            parts.push(`- ${m.key}: ${m.content}`);
          }
        }
      }
    } catch {
    }
    const skillPrompts = this.skills.getActivePrompts();
    if (skillPrompts.length > 0) {
      parts.push("\n## Active Skills");
      for (const p of skillPrompts) {
        parts.push(p);
      }
    }
    return parts.join("\n");
  }
  createInitialState() {
    return {
      step: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      startTime: Date.now(),
      toolCallCount: 0,
      aborted: false,
      messages: []
    };
  }
  // ─── Public API ──────────────────────────────────────────────────
  /** Run the agent with a user prompt (non-streaming) */
  async run(prompt, options) {
    await this.resetState(prompt);
    this.emit("agent:start", { prompt });
    await this.runHook("onStart", { agentState: this.state, step: 0 });
    const signal = options?.signal;
    const maxSteps = options?.maxSteps ?? this.limits.maxSteps;
    try {
      while (this.state.step < maxSteps) {
        if (signal?.aborted || this.state.aborted) {
          this.state.aborted = true;
          break;
        }
        const limitCheck = this.usage.isLimitExceeded();
        if (limitCheck.exceeded) {
          this.emit("agent:error", { error: limitCheck.reason, step: this.state.step });
          break;
        }
        await this.injectMemories(prompt);
        if (this.contextMgr.needsCompression(this.messages)) {
          this.messages = await this.contextMgr.compress(this.messages);
          this.emit("context:compressed", { step: this.state.step });
        }
        const shouldContinue = await this.executeStep(options);
        if (!shouldContinue) break;
      }
      return this.buildResult();
    } catch (err) {
      if (err instanceof ResourceLimitError) {
        this.emit("agent:error", { error: err.message, step: this.state.step });
        return this.buildResult();
      }
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit("agent:error", { error: error.message, step: this.state.step });
      await this.runHook("onError", { agentState: this.state, step: this.state.step });
      throw error;
    }
  }
  /** Run the agent with streaming output */
  async runStream(prompt, options) {
    await this.resetState(prompt);
    this.emit("agent:start", { prompt });
    const signal = options?.signal;
    const maxSteps = options?.maxSteps ?? this.limits.maxSteps;
    try {
      while (this.state.step < maxSteps) {
        if (signal?.aborted || this.state.aborted) {
          this.state.aborted = true;
          break;
        }
        const limitCheck = this.usage.isLimitExceeded();
        if (limitCheck.exceeded) {
          this.emit("agent:error", { error: limitCheck.reason, step: this.state.step });
          break;
        }
        await this.injectMemories(prompt);
        if (this.contextMgr.needsCompression(this.messages)) {
          this.messages = await this.contextMgr.compress(this.messages);
          this.emit("context:compressed", { step: this.state.step });
        }
        const shouldContinue = await this.executeStepStreaming(options);
        if (!shouldContinue) break;
      }
      return this.buildResult();
    } catch (err) {
      if (err instanceof ResourceLimitError) {
        return this.buildResult();
      }
      throw err;
    }
  }
  registerTool(tool) {
    this.registry.register(tool);
  }
  hook(name, fn) {
    if (!this.hooks.has(name)) this.hooks.set(name, []);
    this.hooks.get(name).push(fn);
  }
  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }
  getState() {
    return { ...this.state };
  }
  getUsage() {
    return this.usage.snapshot();
  }
  abort() {
    this.state.aborted = true;
  }
  /** Store a memory item */
  async remember(key, content, layer) {
    await this.memoryInjector.store(key, content, { layer });
  }
  // ─── Memory Injection ────────────────────────────────────────────
  async injectMemories(prompt) {
    const memoryContext = await this.memoryInjector.inject(prompt, 5);
    if (memoryContext) {
      const sysIdx = this.messages.findIndex((m) => typeof m.content === "string" && m.content.includes("Project Memory"));
      if (sysIdx >= 0) {
      } else {
        this.messages.splice(1, 0, { role: "system", content: memoryContext });
      }
    }
    const active = this.skills.activateForInput(prompt);
    if (active.length > 0) {
      const skillTools = this.skills.getActiveTools();
      for (const tool of skillTools) {
        if (!this.registry.has(tool.name)) {
          this.registry.register(tool);
        }
      }
      this.emit("skill:activated", { skills: active.map((s) => s.name) });
    }
  }
  // ─── Step Execution ──────────────────────────────────────────────
  async executeStep(options) {
    const aiTools = this.buildAITools();
    await this.runHook("onBeforeLLMCall", { agentState: this.state, step: this.state.step, messages: this.messages });
    this.emit("llm:call", { step: this.state.step, messageCount: this.messages.length });
    const provider = this.router.getDefault();
    const stepStart = Date.now();
    const result = await generateText({
      model: provider.model,
      system: this.systemPrompt,
      messages: this.messages.slice(1),
      tools: aiTools,
      abortSignal: options?.signal
    });
    return this.processStepResult(result.text, result.toolCalls, result.usage, stepStart, options);
  }
  async executeStepStreaming(options) {
    const aiTools = this.buildAITools();
    await this.runHook("onBeforeLLMCall", { agentState: this.state, step: this.state.step, messages: this.messages });
    this.emit("llm:call", { step: this.state.step, messageCount: this.messages.length });
    const provider = this.router.getDefault();
    const stepStart = Date.now();
    const streamResults = streamText({
      model: provider.model,
      system: this.systemPrompt,
      messages: this.messages.slice(1),
      tools: aiTools,
      abortSignal: options?.signal
    });
    const consumed = await streamResults;
    let fullText = "";
    for await (const chunk of consumed.textStream) {
      fullText += chunk;
      if (options?.onText) options.onText(chunk);
    }
    const finalText = typeof consumed.text === "string" ? consumed.text : fullText;
    const finalToolCalls = Array.isArray(consumed.toolCalls) ? consumed.toolCalls : [];
    return this.processStepResult(
      finalText || void 0,
      finalToolCalls,
      consumed.usage,
      stepStart,
      options
    );
  }
  async processStepResult(text, toolCalls, usage, stepStart, options) {
    const stepDuration = Date.now() - stepStart;
    if (usage) {
      this.usage.recordTokens(usage.promptTokens ?? 0, usage.completionTokens ?? 0);
      this.state.totalTokensUsed = this.usage.totalTokens;
      this.state.totalCost = this.usage.estimatedCost;
    }
    await this.runHook("onAfterLLMCall", { agentState: this.state, step: this.state.step, messages: this.messages });
    this.emit("llm:response", { step: this.state.step, tokensUsed: usage?.totalTokens });
    const stepInfo = {
      step: this.state.step,
      text: text || void 0,
      durationMs: stepDuration,
      tokensUsed: usage ? { input: usage.promptTokens ?? 0, output: usage.completionTokens ?? 0 } : void 0
    };
    if (toolCalls && toolCalls.length > 0) {
      const toolResults = [];
      stepInfo.toolCalls = toolCalls.map((tc) => ({ tool: tc.toolName, args: tc.args }));
      for (const tc of toolCalls) {
        const call = { tool: tc.toolName, args: tc.args };
        const tr = await this.executeToolCall(call, options?.signal);
        toolResults.push(tr);
      }
      stepInfo.toolResults = toolResults;
      this.messages.push({ role: "assistant", content: text ?? "" });
      for (const tr of toolResults) {
        this.messages.push({
          role: "user",
          content: `[Tool: ${tr.tool}] ${tr.error ? `Error: ${tr.error}` : JSON.stringify(tr.output)}`
        });
      }
    } else {
      if (text) this.messages.push({ role: "assistant", content: text });
    }
    this.steps.push(stepInfo);
    this.usage.recordStep();
    this.state.step++;
    if (options?.onStep) options.onStep(stepInfo);
    this.emit("step", { step: this.state.step });
    return !!toolCalls?.length;
  }
  async executeToolCall(call, signal) {
    const toolDef = this.registry.get(call.tool);
    const approvalRequest = {
      tool: call.tool,
      args: call.args,
      permission: toolDef?.permission ?? { level: "dangerous" }
    };
    const approval = await this.guard.check(approvalRequest);
    if (approval === "deny") {
      this.emit("tool:denied", { tool: call.tool, args: call.args });
      return { tool: call.tool, output: null, error: `Permission denied for "${call.tool}"`, durationMs: 0, approved: false };
    }
    this.emit("tool:approved", { tool: call.tool, args: call.args, approval });
    const preHookResult = await this.runHook("onBeforeToolCall", { agentState: this.state, step: this.state.step, toolCall: call });
    if (preHookResult?.action === "deny") {
      return { tool: call.tool, output: null, error: preHookResult.reason ?? "Blocked by hook", durationMs: 0, approved: false };
    }
    this.emit("tool:call", { tool: call.tool, args: call.args });
    this.usage.recordToolCall();
    this.state.toolCallCount++;
    const toolCtx = createToolContext(
      this.getSnapshot(),
      this.workingDir,
      signal ?? new AbortController().signal,
      (req) => this.guard.check(req)
    );
    const toolResult = await this.engine.execute(call, toolCtx);
    if (toolResult.output) toolResult.output = this.contextMgr.truncateToolOutput(toolResult.output);
    this.emit("tool:result", { tool: call.tool, result: toolResult });
    await this.runHook("onAfterToolCall", { agentState: this.state, step: this.state.step, toolCall: call, toolResult });
    return toolResult;
  }
  // ─── Build Result ────────────────────────────────────────────────
  buildResult() {
    const finalText = this.extractFinalText();
    this.runHook("onEnd", { agentState: this.state, step: this.state.step });
    this.emit("agent:end", { steps: this.state.step, durationMs: this.usage.elapsedMs, totalCost: this.usage.estimatedCost });
    return {
      text: finalText,
      messages: this.messages,
      state: { ...this.state, messages: this.messages },
      steps: this.steps,
      totalDurationMs: this.usage.elapsedMs,
      usage: this.usage.snapshot()
    };
  }
  async resetState(prompt) {
    this.state = this.createInitialState();
    this.steps = [];
    this.messages = [{ role: "system", content: await this.buildSystemPrompt() }];
    this.messages.push({ role: "user", content: prompt });
    this.usage.reset();
    this.guard.resetAllowAlways();
    this.contextMgr.adaptToProvider();
  }
  // ─── Private Helpers ─────────────────────────────────────────────
  buildAITools() {
    const allTools = [
      ...this.registry.getAll(),
      ...this.skills.getActiveTools()
    ];
    const tools = {};
    for (const toolDef of allTools) {
      if (!tools[toolDef.name]) {
        tools[toolDef.name] = {
          description: toolDef.description,
          parameters: toolDef.parameters,
          execute: async (args) => args
        };
      }
    }
    return tools;
  }
  async runHook(name, ctx) {
    const fns = this.hooks.get(name) ?? [];
    let result;
    for (const fn of fns) {
      result = await fn(ctx);
      if (result?.action === "deny") return result;
    }
    return result;
  }
  emit(type, data) {
    const event = { type, timestamp: Date.now(), data };
    for (const handler of this.eventHandlers.get(type) ?? []) {
      try {
        handler(event);
      } catch {
      }
    }
  }
  getSnapshot() {
    return { step: this.state.step, totalTokensUsed: this.state.totalTokensUsed, startTime: this.state.startTime };
  }
  extractFinalText() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") {
        const c = this.messages[i].content;
        return typeof c === "string" ? c : "";
      }
    }
    return "";
  }
};
function createAgent(config) {
  return new Agent(config);
}
var SkillLoaderWorker = class {
  skills = [];
  async loadAll(dirs) {
    const { SkillLoader } = await import("@agentnova/skills");
    const loader = new SkillLoader();
    this.skills = await loader.loadAll(dirs);
  }
  activateForInput(input) {
    const active = [];
    for (const skill of this.skills) {
      if (skill.activateOn) {
        if (skill.activateOn(input)) {
          if (!skill.active) {
            skill.active = true;
            active.push(skill);
          }
        }
      }
    }
    return active;
  }
  getActiveTools() {
    return this.skills.filter((s) => s.active).flatMap((s) => s.tools);
  }
  getActivePrompts() {
    return this.skills.filter((s) => s.active && s.prompt).map((s) => s.prompt);
  }
};
export {
  Agent,
  ContextManager,
  DEFAULT_CONTEXT_CONFIG,
  PROVIDER_PRICING,
  ResourceLimitError,
  UsageTracker,
  createAgent,
  getPricing
};
//# sourceMappingURL=index.js.map