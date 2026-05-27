"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Agent: () => Agent,
  ContextManager: () => ContextManager,
  DEFAULT_CONTEXT_CONFIG: () => DEFAULT_CONTEXT_CONFIG,
  createAgent: () => createAgent
});
module.exports = __toCommonJS(index_exports);

// src/agent.ts
var import_ai = require("ai");
var import_tools = require("@agentnova/tools");
var import_permission = require("@agentnova/permission");

// src/context.ts
var DEFAULT_CONTEXT_CONFIG = {
  preserveRecentTurns: 10,
  compressionTriggerRatio: 0.7,
  compressionStrategy: "hybrid",
  maxToolOutputLength: 8e3,
  toolOutputTruncate: "tail"
};
var ContextManager = class {
  constructor(config, router) {
    this.router = router;
    this.config = config;
  }
  router;
  config;
  /** Estimate token count for messages (rough: 1 token ≈ 4 chars) */
  estimateTokens(messages) {
    const total = messages.reduce((sum, msg) => {
      if (typeof msg.content === "string") {
        return sum + Math.ceil(msg.content.length / 4);
      }
      if (Array.isArray(msg.content)) {
        return sum + msg.content.reduce((s, part) => {
          if (part.type === "text") return s + Math.ceil(part.text.length / 4);
          if (part.type === "tool-result") {
            const resultStr = typeof part.result === "string" ? part.result : JSON.stringify(part.result);
            return s + Math.ceil(resultStr.length / 4);
          }
          return s;
        }, 0);
      }
      return sum;
    }, 0);
    return total;
  }
  /** Get the context window size for current provider */
  getContextWindow() {
    const defaultProvider = this.router.getDefault();
    return defaultProvider.contextWindow ?? 128e3;
  }
  /** Check if compression is needed */
  needsCompression(messages) {
    const tokens = this.estimateTokens(messages);
    const threshold = this.getContextWindow() * this.config.compressionTriggerRatio;
    return tokens > threshold;
  }
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
      // Just drop older messages
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
  /** Truncate a tool output to fit budget */
  truncateToolOutput(output) {
    const str = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    if (str.length <= this.config.maxToolOutputLength) return str;
    if (this.config.toolOutputTruncate === "head") {
      return "... [truncated]\n" + str.slice(-this.config.maxToolOutputLength);
    }
    return str.slice(0, this.config.maxToolOutputLength) + "\n... [truncated]";
  }
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
  /** Summarize a block of older messages */
  async summarizeMessages(messages, summarizer) {
    const text = messages.map((m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `[${m.role}]: ${content}`;
    }).join("\n");
    const summary = await summarizer(text);
    return {
      role: "system",
      content: `[Conversation Summary]
${summary}`
    };
  }
  /** Extract key messages (user + assistant without large tool results) */
  extractKeyMessages(messages) {
    return messages.map((msg) => {
      if (msg.role === "tool") {
        const truncated = this.truncateToolOutput(
          typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        );
        return { role: "user", content: `[Tool Output]: ${truncated}` };
      }
      return msg;
    });
  }
};

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
var Agent = class {
  registry;
  engine;
  guard;
  router;
  contextMgr;
  systemPrompt;
  workingDir;
  permissions;
  limits;
  contextConfig;
  state;
  messages = [];
  hooks = /* @__PURE__ */ new Map();
  eventHandlers = /* @__PURE__ */ new Map();
  steps = [];
  constructor(config) {
    this.systemPrompt = config.systemPrompt;
    this.workingDir = config.workingDir;
    this.registry = new import_tools.ToolRegistry();
    this.registry.registerAll(config.tools);
    this.engine = new import_tools.ToolEngine(this.registry);
    this.permissions = {
      ...import_permission.DEFAULT_PERMISSION_CONFIG,
      ...config.permissions,
      limits: { ...import_permission.DEFAULT_LIMITS, ...config.permissions?.limits }
    };
    this.guard = new import_permission.PermissionGuard(this.permissions);
    this.router = config.router;
    this.contextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config.context };
    this.contextMgr = new ContextManager(this.contextConfig, this.router);
    this.limits = { ...import_permission.DEFAULT_LIMITS, ...this.permissions.limits };
    this.state = {
      step: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      startTime: Date.now(),
      toolCallCount: 0,
      aborted: false,
      messages: []
    };
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }
  // ─── Public API ──────────────────────────────────────────────────
  async run(prompt, options) {
    this.state = {
      step: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      startTime: Date.now(),
      toolCallCount: 0,
      aborted: false,
      messages: [{ role: "system", content: this.systemPrompt }]
    };
    this.steps = [];
    this.messages.push({ role: "user", content: prompt });
    this.emit("agent:start", { prompt });
    await this.runHook("onStart", { agentState: this.state, step: 0 });
    const maxSteps = options?.maxSteps ?? this.limits.maxSteps;
    const signal = options?.signal;
    const runStart = Date.now();
    try {
      while (this.state.step < maxSteps) {
        if (signal?.aborted || this.state.aborted) {
          this.state.aborted = true;
          break;
        }
        if (this.state.totalTokensUsed >= this.limits.maxTokens) break;
        if (this.state.toolCallCount >= this.limits.maxToolCalls) break;
        if (Date.now() - this.state.startTime >= this.limits.timeoutMs) break;
        if (this.contextMgr.needsCompression(this.messages)) {
          this.messages = await this.contextMgr.compress(this.messages);
          this.emit("context:compressed", { step: this.state.step });
        }
        const aiTools = this.buildAITools();
        await this.runHook("onBeforeLLMCall", {
          agentState: this.state,
          step: this.state.step,
          messages: this.messages
        });
        this.emit("llm:call", { step: this.state.step, messageCount: this.messages.length });
        const provider = this.router.getDefault();
        const stepStart = Date.now();
        const result = await (0, import_ai.generateText)({
          model: provider.model,
          system: this.systemPrompt,
          messages: this.messages.slice(1),
          tools: aiTools,
          abortSignal: signal
        });
        const stepDuration = Date.now() - stepStart;
        if (result.usage) {
          this.state.totalTokensUsed += result.usage.totalTokens ?? 0;
        }
        await this.runHook("onAfterLLMCall", {
          agentState: this.state,
          step: this.state.step,
          messages: this.messages
        });
        this.emit("llm:response", { step: this.state.step, tokensUsed: result.usage?.totalTokens });
        const stepInfo = {
          step: this.state.step,
          text: result.text || void 0,
          durationMs: stepDuration
        };
        if (result.text && options?.onText) {
          options.onText(result.text);
        }
        if (result.toolCalls && result.toolCalls.length > 0) {
          const toolResults = [];
          stepInfo.toolCalls = result.toolCalls.map((tc) => ({
            tool: tc.toolName,
            args: tc.args
          }));
          for (const toolCall of result.toolCalls) {
            const call = {
              tool: toolCall.toolName,
              args: toolCall.args
            };
            const toolDef = this.registry.get(toolCall.toolName);
            const approvalRequest = {
              tool: toolCall.toolName,
              args: call.args,
              permission: toolDef?.permission ?? { level: "dangerous" }
            };
            const approval = await this.guard.check(approvalRequest);
            if (approval === "deny") {
              this.emit("tool:denied", { tool: toolCall.toolName, args: call.args });
              toolResults.push({
                tool: toolCall.toolName,
                output: null,
                error: `Permission denied for tool "${toolCall.toolName}"`,
                durationMs: 0,
                approved: false
              });
              continue;
            }
            this.emit("tool:approved", { tool: toolCall.toolName, args: call.args, approval });
            const preHookCtx = {
              agentState: this.state,
              step: this.state.step,
              toolCall: call
            };
            const preHookResult = await this.runHook("onBeforeToolCall", preHookCtx);
            if (preHookResult?.action === "deny") {
              toolResults.push({
                tool: toolCall.toolName,
                output: null,
                error: preHookResult.reason ?? "Blocked by hook",
                durationMs: 0,
                approved: false
              });
              continue;
            }
            this.emit("tool:call", { tool: toolCall.toolName, args: call.args });
            this.state.toolCallCount++;
            const toolCtx = createToolContext(
              this.getSnapshot(),
              this.workingDir,
              signal ?? new AbortController().signal,
              (req) => this.guard.check(req)
            );
            const toolResult = await this.engine.execute(call, toolCtx);
            if (toolResult.output) {
              toolResult.output = this.contextMgr.truncateToolOutput(toolResult.output);
            }
            toolResults.push(toolResult);
            this.emit("tool:result", { tool: toolCall.toolName, result: toolResult });
            await this.runHook("onAfterToolCall", {
              agentState: this.state,
              step: this.state.step,
              toolCall: call,
              toolResult
            });
          }
          stepInfo.toolResults = toolResults;
          this.messages.push({ role: "assistant", content: result.text ?? "" });
          for (const tr of toolResults) {
            this.messages.push({
              role: "user",
              content: `[Tool: ${tr.tool}] ${tr.error ? `Error: ${tr.error}` : JSON.stringify(tr.output)}`
            });
          }
        } else {
          if (result.text) {
            this.messages.push({ role: "assistant", content: result.text });
          }
        }
        this.steps.push(stepInfo);
        this.state.step++;
        if (options?.onStep) {
          options.onStep(stepInfo);
        }
        this.emit("step", { step: this.state.step });
        if (!result.toolCalls?.length && result.text) {
          break;
        }
      }
      const finalText = this.extractFinalText();
      const agentResult = {
        text: finalText,
        messages: this.messages,
        state: { ...this.state, messages: this.messages },
        steps: this.steps,
        totalDurationMs: Date.now() - runStart
      };
      await this.runHook("onEnd", { agentState: this.state, step: this.state.step });
      this.emit("agent:end", { steps: this.state.step, durationMs: agentResult.totalDurationMs });
      return agentResult;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit("agent:error", { error: error.message, step: this.state.step });
      await this.runHook("onError", { agentState: this.state, step: this.state.step });
      throw error;
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
  // ─── Private ─────────────────────────────────────────────────────
  buildAITools() {
    const tools = {};
    for (const toolDef of this.registry.getAll()) {
      tools[toolDef.name] = {
        description: toolDef.description,
        parameters: toolDef.parameters,
        execute: async (args) => args
      };
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
    const handlers = this.eventHandlers.get(type) ?? [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
      }
    }
  }
  getSnapshot() {
    return {
      step: this.state.step,
      totalTokensUsed: this.state.totalTokensUsed,
      startTime: this.state.startTime
    };
  }
  extractFinalText() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") {
        const content = this.messages[i].content;
        return typeof content === "string" ? content : "";
      }
    }
    return "";
  }
};
function createAgent(config) {
  return new Agent(config);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Agent,
  ContextManager,
  DEFAULT_CONTEXT_CONFIG,
  createAgent
});
//# sourceMappingURL=index.cjs.map