// src/agent.ts
import { generateText as generateText2, streamText } from "ai";
import { ToolRegistry, ToolEngine } from "@agentnova/tools";
import { PermissionGuard, DEFAULT_PERMISSION_CONFIG, DEFAULT_LIMITS } from "@agentnova/permission";

// src/context.ts
import { generateText } from "ai";
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
  // ─── Token Budget ────────────────────────────────────────────────
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
  /** Calculate current token budget */
  getBudget(messages) {
    const window = this.getContextWindow();
    const usable = Math.floor(window * 0.8);
    const consumed = this.estimateTokens(messages);
    const responseReserve = Math.max(2e3, Math.floor((usable - consumed) * 0.3));
    return {
      window,
      usable,
      consumed,
      remaining: Math.max(0, usable - consumed - responseReserve),
      responseReserve
    };
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
  // ─── Adaptive Memory Injection ───────────────────────────────────
  /**
   * Calculate how many memory items can be injected given current budget.
   * Returns { topK, maxItemLength } — adaptively scales down when tight.
   */
  calculateMemoryBudget(messages, requestedTopK) {
    const budget = this.getBudget(messages);
    const remaining = budget.remaining;
    if (remaining < 2e3) {
      return { topK: Math.min(1, requestedTopK), maxItemLength: 200, budgetRemaining: remaining };
    }
    if (remaining < 5e3) {
      return { topK: Math.min(2, requestedTopK), maxItemLength: 500, budgetRemaining: remaining };
    }
    if (remaining < 1e4) {
      return { topK: Math.min(3, requestedTopK), maxItemLength: 1e3, budgetRemaining: remaining };
    }
    return { topK: requestedTopK, maxItemLength: 2e3, budgetRemaining: remaining };
  }
  // ─── Compression ─────────────────────────────────────────────────
  /**
   * Compress messages with full metadata tracking.
   * Now supports auto-LLM summarization when no external summarizer is provided.
   */
  async compress(messages, summarizer) {
    const result = await this.compressWithMeta(messages, summarizer);
    return result.messages;
  }
  /**
   * Full compression with observability metadata.
   */
  async compressWithMeta(messages, externalSummarizer) {
    const originalTokens = this.estimateTokens(messages);
    if (!this.needsCompression(messages)) {
      return {
        messages,
        originalTokenCount: originalTokens,
        compressedTokenCount: originalTokens,
        strategy: this.config.compressionStrategy,
        droppedCount: 0
      };
    }
    const [recent, older] = this.splitMessages(messages, this.config.preserveRecentTurns);
    if (older.length === 0) {
      return {
        messages: recent,
        originalTokenCount: originalTokens,
        compressedTokenCount: this.estimateTokens(recent),
        strategy: "sliding-window",
        droppedCount: older.length
      };
    }
    switch (this.config.compressionStrategy) {
      case "sliding-window": {
        return {
          messages: recent,
          originalTokenCount: originalTokens,
          compressedTokenCount: this.estimateTokens(recent),
          strategy: "sliding-window",
          droppedCount: older.length
        };
      }
      case "summary": {
        const summary = await this.summarizeBlock(older, externalSummarizer);
        const result = summary ? [summary, ...recent] : recent;
        return {
          messages: result,
          originalTokenCount: originalTokens,
          compressedTokenCount: this.estimateTokens(result),
          strategy: "summary",
          summarized: !!summary,
          droppedCount: older.length
        };
      }
      case "hybrid":
      default: {
        const annotated = this.annotateMessages(older);
        const summary = await this.summarizeBlock(annotated.map((a) => a.msg), externalSummarizer);
        const keyMessages = this.extractKeyMessagesSemantic(annotated);
        if (summary) {
          const result2 = [summary, ...recent];
          return {
            messages: result2,
            originalTokenCount: originalTokens,
            compressedTokenCount: this.estimateTokens(result2),
            strategy: "hybrid",
            summarized: true,
            droppedCount: older.length - keyMessages.length
          };
        }
        const result = [...keyMessages, ...recent];
        return {
          messages: result,
          originalTokenCount: originalTokens,
          compressedTokenCount: this.estimateTokens(result),
          strategy: "hybrid",
          droppedCount: older.length - keyMessages.length
        };
      }
    }
  }
  // ─── Progressive Compression ─────────────────────────────────────
  /**
   * Proactively compress after a tool call that returns large output.
   * Called by Agent before the tool result is added to messages.
   */
  async compressAfterToolCall(messages, toolOutputTokens, summarizer) {
    const budget = this.getBudget(messages);
    const projectedTokens = budget.consumed + toolOutputTokens;
    const threshold = budget.usable * 0.85;
    if (projectedTokens > threshold) {
      return this.compress(messages, summarizer);
    }
    return messages;
  }
  // ─── Tool Output Handling ────────────────────────────────────────
  /** Truncate a tool output to fit budget, with awareness of remaining space */
  truncateToolOutput(output, messages) {
    let str;
    try {
      str = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    } catch {
      str = String(output);
    }
    if (messages) {
      const budget = this.getBudget(messages);
      const maxGivenBudget = Math.floor(budget.remaining * 0.4);
      const effectiveMax = Math.min(this.config.maxToolOutputLength, maxGivenBudget);
      if (str.length <= effectiveMax) return str;
      if (this.config.toolOutputTruncate === "head") {
        return str.slice(0, effectiveMax) + "\n... [truncated]";
      }
      return "... [truncated]\n" + str.slice(-effectiveMax);
    }
    if (str.length <= this.config.maxToolOutputLength) return str;
    if (this.config.toolOutputTruncate === "head") {
      return str.slice(0, this.config.maxToolOutputLength) + "\n... [truncated]";
    }
    return "... [truncated]\n" + str.slice(-this.config.maxToolOutputLength);
  }
  // ─── Message Priorities (Semantic) ──────────────────────────────
  /**
   * Assign priority to a message based on semantic content analysis.
   * This is much smarter than the v1 version that only looked at role.
   */
  messagePriority(msg) {
    const text = this.extractText(msg).toLowerCase();
    let priority = 20;
    if (msg.role === "system") return 100;
    if (msg.role === "user") priority = 70;
    if (/\b(error|fail|exception|bug|wrong|incorrect|doesn'?t work|not found)\b/.test(text)) {
      priority += 25;
    }
    if (/\b(i want|use|don'?t use|prefer|always|never|must|should|please)\b/.test(text)) {
      priority += 20;
    }
    if (/\b(it|that|this|the above|previous|earlier|just|recently)\b/.test(text)) {
      priority += 15;
    }
    if (msg.role === "assistant" && text.length > 100) {
      priority += 10;
    }
    if (/[\d]+\.[\d]+|\/[\w/]+\.[\w]+|localhost|0\.0\.0\.0|=\s*["']/.test(text)) {
      priority += 10;
    }
    return Math.min(priority, 100);
  }
  // ─── Private: Annotation ─────────────────────────────────────────
  /** Annotate messages with semantic metadata for smarter compression */
  annotateMessages(messages) {
    let turnGroup = 0;
    let lastUserRole = -1;
    return messages.map((msg, index) => {
      const text = this.extractText(msg);
      if (msg.role === "user" && index > lastUserRole) {
        turnGroup++;
        lastUserRole = index;
      }
      return {
        msg,
        index,
        tokenEstimate: this.estimateTextTokens(text) + 4,
        priority: this.messagePriority(msg),
        hasReference: /\b(it|that|this|the above|previous|earlier)\b/i.test(text),
        isToolResult: text.startsWith("[Tool") || msg.role === "tool",
        turnGroup
      };
    });
  }
  // ─── Private: Semantic Key Message Extraction ────────────────────
  /**
   * Extract key messages using semantic annotations.
   * Much smarter than v1 — preserves error info, pronoun references, and user decisions.
   */
  extractKeyMessages(annotated) {
    const HIGH_PRIORITY_THRESHOLD = 60;
    const MAX_TOOL_RESULT_LEN = 500;
    const kept = [];
    const dropped = [];
    for (const am of annotated) {
      if (am.priority >= HIGH_PRIORITY_THRESHOLD) {
        kept.push(am);
      } else if (am.isToolResult && am.tokenEstimate < MAX_TOOL_RESULT_LEN) {
        kept.push(am);
      } else {
        dropped.push(am);
      }
    }
    if (dropped.length > annotated.length * 0.5) {
      dropped.filter((am) => am.priority >= 40).sort((a, b) => b.priority - a.priority).slice(0, Math.ceil(annotated.length * 0.2)).forEach((am) => kept.push(am));
    }
    kept.sort((a, b) => a.index - b.index);
    return kept.map((am) => {
      if (am.isToolResult && am.tokenEstimate > MAX_TOOL_RESULT_LEN) {
        const text = this.extractText(am.msg);
        return {
          ...am.msg,
          content: `[Tool Result Summary]: ${text.slice(0, MAX_TOOL_RESULT_LEN)}...`
        };
      }
      return am.msg;
    });
  }
  /** Alias for backward compat */
  extractKeyMessagesSemantic = this.extractKeyMessages;
  // ─── Private: Summarization ──────────────────────────────────────
  /**
   * Summarize a block of messages.
   * Strategy:
   * 1. If external summarizer provided, use it
   * 2. Otherwise, try using the Agent's own LLM (via router) for auto-summarization
   * 3. If neither works, fall back to semantic extraction
   */
  async summarizeBlock(messages, externalSummarizer) {
    if (messages.length === 0) return null;
    if (externalSummarizer) {
      const text = this.formatMessagesForSummary(messages);
      const summary = await externalSummarizer(text);
      return this.buildSummaryMessage(summary);
    }
    try {
      const provider = this.router.getDefault();
      const text = this.formatMessagesForSummary(messages);
      const result = await generateText({
        model: provider.model,
        system: `You are a conversation compressor. Summarize the following conversation history into a concise summary that:
1. Preserves all user decisions, preferences, and instructions
2. Resolves pronouns (replace "it", "that" with the actual referent)
3. Keeps error messages and their resolutions
4. Notes any file paths, config values, or specific technical details
5. Tracks the sequence of actions taken
Be concise but complete. Use bullet points for clarity.`,
        prompt: text,
        maxTokens: 1e3
      });
      return this.buildSummaryMessage(result.text);
    } catch {
      return null;
    }
  }
  /** Format messages for summarization input */
  formatMessagesForSummary(messages) {
    return messages.map((m) => {
      const content = this.extractText(m);
      const truncated = content.length > 3e3 ? content.slice(0, 1500) + "\n...[truncated]...\n" + content.slice(-1500) : content;
      return `[${m.role}]: ${truncated}`;
    }).join("\n\n");
  }
  /** Build a summary message with standard format */
  buildSummaryMessage(summary) {
    return {
      role: "system",
      content: `[Conversation Summary \u2014 earlier context compressed]
${summary}`
    };
  }
  // ─── Private: Message Splitting ──────────────────────────────────
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
  return PROVIDER_PRICING[providerId] ?? PROVIDER_PRICING[providerId.split(":")[0]] ?? PROVIDER_PRICING["openai-gpt4o"];
}

// src/logger.ts
var LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
var StructuredLogger = class {
  logs = [];
  minLevel;
  consoleOutput;
  filePath;
  maxFileSize;
  maxFiles;
  samplingRate;
  traceId;
  writeQueue = Promise.resolve();
  logCounts = { debug: 0, info: 0, warn: 0, error: 0 };
  constructor(config) {
    this.minLevel = config?.minLevel ?? "info";
    this.consoleOutput = config?.console ?? process.env.NODE_ENV !== "production";
    this.filePath = config?.filePath;
    this.maxFileSize = config?.maxFileSize ?? 10 * 1024 * 1024;
    this.maxFiles = config?.maxFiles ?? 3;
    this.samplingRate = config?.samplingRate ?? 1;
    this.traceId = config?.traceId;
  }
  debug(message, data) {
    this.log("debug", message, data);
  }
  info(message, data) {
    this.log("info", message, data);
  }
  warn(message, data) {
    this.log("warn", message, data);
  }
  error(message, data) {
    this.log("error", message, data);
  }
  log(level, message, data) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;
    if (level === "debug" || level === "info") {
      this.logCounts[level]++;
      if (this.samplingRate > 1 && this.logCounts[level] % this.samplingRate !== 1) return;
    }
    const entry = {
      level,
      timestamp: Date.now(),
      message,
      data,
      traceId: this.traceId
    };
    this.logs.push(entry);
    const ts = new Date(entry.timestamp).toISOString().slice(11, 23);
    const prefix = `[${level.toUpperCase()}]`;
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    const output = `${prefix} ${ts} ${message}${dataStr}`;
    if (this.consoleOutput) {
      switch (level) {
        case "error":
          console.error(output);
          break;
        case "warn":
          console.warn(output);
          break;
        default:
          console.log(output);
      }
    }
    if (this.filePath) {
      this.writeQueue = this.writeQueue.then(() => this.writeToFile(entry)).catch(() => {
      });
    }
  }
  async writeToFile(entry) {
    if (!this.filePath) return;
    const { appendFile, stat, rename } = await import("fs/promises");
    const { existsSync: existsSync2 } = await import("fs");
    try {
      if (existsSync2(this.filePath)) {
        const stats = await stat(this.filePath);
        if (stats.size >= this.maxFileSize) {
          await this.rotateLogs();
        }
      }
    } catch {
    }
    const line = JSON.stringify(entry) + "\n";
    try {
      await appendFile(this.filePath, line, "utf-8");
    } catch {
      const { mkdir: mkdir2 } = await import("fs/promises");
      const { dirname: dirname2 } = await import("path");
      await mkdir2(dirname2(this.filePath), { recursive: true });
      await appendFile(this.filePath, line, "utf-8");
    }
  }
  async rotateLogs() {
    if (!this.filePath) return;
    const { rename, unlink } = await import("fs/promises");
    const { existsSync: existsSync2 } = await import("fs");
    const oldest = `${this.filePath}.${this.maxFiles}`;
    if (existsSync2(oldest)) await unlink(oldest).catch(() => {
    });
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = `${this.filePath}.${i}`;
      const to = `${this.filePath}.${i + 1}`;
      if (existsSync2(from)) await rename(from, to).catch(() => {
      });
    }
    await rename(this.filePath, `${this.filePath}.1`).catch(() => {
    });
  }
  /** Get all logs (in-memory) */
  getLogs(level) {
    if (level) return this.logs.filter((l) => l.level === level);
    return this.logs;
  }
  /** Export as newline-delimited JSON */
  exportNDJSON() {
    return this.logs.map((l) => JSON.stringify(l)).join("\n");
  }
  /** Clear in-memory logs */
  clear() {
    this.logs = [];
  }
  /** Set trace ID */
  setTraceId(id) {
    this.traceId = id;
  }
};
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

// src/trace.ts
var TraceCollector = class {
  entries = [];
  startTime = Date.now();
  traceId;
  providerId;
  constructor(providerId) {
    this.traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.providerId = providerId;
  }
  /** Record a trace entry */
  record(type, data) {
    this.entries.push({ type, timestamp: Date.now(), data });
  }
  /** Build final trace snapshot */
  buildTrace(steps, totalTokens, totalCost) {
    return {
      id: this.traceId,
      startTime: this.startTime,
      endTime: Date.now(),
      entries: this.entries,
      steps,
      totalTokens,
      totalCost,
      provider: this.providerId
    };
  }
  /** Reset for new run */
  reset(providerId) {
    this.entries = [];
    this.startTime = Date.now();
    this.traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (providerId) this.providerId = providerId;
  }
  /** Get raw entries (for streaming consumption) */
  getEntries() {
    return this.entries;
  }
};
var TraceReplay = class {
  constructor(trace) {
    this.trace = trace;
  }
  trace;
  /** Replay trace step by step */
  async replay(options) {
    const delay = options?.delayMs ?? 100;
    for (let i = 0; i < this.trace.entries.length; i++) {
      const entry = this.trace.entries[i];
      options?.onStep?.(entry, i);
      if (delay > 0 && i < this.trace.entries.length - 1) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  /** Get summary string */
  summary() {
    const lines = [
      `Trace: ${this.trace.id}`,
      `Provider: ${this.trace.provider}`,
      `Duration: ${this.trace.endTime - this.trace.startTime}ms`,
      `Steps: ${this.trace.steps.length}`,
      `Tokens: ${this.trace.totalTokens}`,
      `Cost: $${this.trace.totalCost.toFixed(4)}`,
      ""
    ];
    for (const entry of this.trace.entries) {
      const ts = new Date(entry.timestamp).toISOString().slice(11, 23);
      switch (entry.type) {
        case "step":
          lines.push(`[${ts}] STEP #${entry.data.step}`);
          break;
        case "tool_call":
          lines.push(`[${ts}] \u{1F527} ${entry.data.tool}(${JSON.stringify(entry.data.args)?.slice(0, 80)})`);
          break;
        case "tool_result":
          lines.push(`[${ts}] \u{1F4E4} ${entry.data.tool}: ${entry.data.error ? `\u274C ${entry.data.error}` : "\u2705"}`);
          break;
        case "llm_call":
          lines.push(`[${ts}] \u{1F916} LLM call (${entry.data.tokens} tokens)`);
          break;
        case "compression":
          lines.push(`[${ts}] \u{1F5DC}\uFE0F Context compressed`);
          break;
        case "skill":
          lines.push(`[${ts}] \u26A1 Skill ${entry.data.action}: ${entry.data.name}`);
          break;
        case "provider_fallback":
          lines.push(`[${ts}] \u{1F504} Fallback: ${entry.data.from} \u2192 next (${entry.data.error})`);
          break;
      }
    }
    return lines.join("\n");
  }
  /** Export as JSON */
  toJSON() {
    return JSON.stringify(this.trace, null, 2);
  }
};

// src/skill-worker.ts
var SkillLoaderWorker = class {
  skills = [];
  async loadAll(dirs) {
    const { SkillLoader } = await import("@agentnova/skills");
    const loader = new SkillLoader();
    const loaded = await loader.loadAll(dirs);
    this.skills = loaded.map((s) => ({
      name: s.name,
      tools: s.tools ?? [],
      prompt: s.prompt ?? "",
      active: s.active,
      activateOn: s.activateOn
    }));
  }
  activateForInput(input) {
    const activated = [];
    for (const skill of this.skills) {
      if (skill.activateOn?.(input) && !skill.active) {
        skill.active = true;
        activated.push(skill);
      }
    }
    return activated;
  }
  getActiveTools() {
    return this.skills.filter((s) => s.active).flatMap((s) => s.tools);
  }
  getActivePrompts() {
    return this.skills.filter((s) => s.active && s.prompt).map((s) => s.prompt);
  }
};

// src/agent.ts
import { WorkingMemory, ProjectMemory, MemoryInjector, LongTermMemory } from "@agentnova/memory";
var Agent = class {
  registry;
  engine;
  guard;
  router;
  contextMgr;
  usage;
  tracer;
  logger;
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
  projectMemoryReady = Promise.resolve();
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
    this.tracer = new TraceCollector(provider.id);
    this.logger = new StructuredLogger({ traceId: this.tracer["traceId"] });
    this.workingMemory = new WorkingMemory();
    this.projectMemory = new ProjectMemory(this.workingDir);
    this.projectMemoryReady = this.projectMemory.load().catch(() => {
    });
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
          const compressed = await this.contextMgr.compressWithMeta(this.messages);
          this.messages = compressed.messages;
          this.emit("context:compressed", {
            step: this.state.step,
            originalTokens: compressed.originalTokenCount,
            compressedTokens: compressed.compressedTokenCount,
            strategy: compressed.strategy
          });
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
          const compressed = await this.contextMgr.compressWithMeta(this.messages);
          this.messages = compressed.messages;
          this.emit("context:compressed", {
            step: this.state.step,
            originalTokens: compressed.originalTokenCount,
            compressedTokens: compressed.compressedTokenCount,
            strategy: compressed.strategy
          });
        }
        const shouldContinue = await this.executeStepStreaming(options);
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
  /** Get execution trace */
  getTrace() {
    return this.tracer.buildTrace(this.steps, this.usage.totalTokens, this.usage.estimatedCost);
  }
  /** Get trace replay */
  replayTrace() {
    return new TraceReplay(this.getTrace());
  }
  /** Get structured logger */
  getLogger() {
    return this.logger;
  }
  /** Store a memory item */
  async remember(key, content, layer) {
    await this.memoryInjector.store(key, content, { layer });
  }
  // ─── Memory Injection ────────────────────────────────────────────
  memoryMessageIdx = -1;
  async injectMemories(prompt) {
    const budget = this.contextMgr.calculateMemoryBudget(this.messages, 5);
    const memoryContext = await this.memoryInjector.inject(prompt, 5, {
      maxItemLength: budget.maxItemLength,
      remaining: budget.budgetRemaining
    });
    if (memoryContext) {
      if (this.memoryMessageIdx >= 0 && this.memoryMessageIdx < this.messages.length) {
        this.messages[this.memoryMessageIdx] = { role: "system", content: memoryContext };
      } else {
        this.messages.splice(1, 0, { role: "system", content: memoryContext });
        this.memoryMessageIdx = 1;
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
    const stepStart = Date.now();
    const fallbackChain = this.router.getFallbackChain();
    let lastError;
    for (const provider of fallbackChain) {
      try {
        const result = await generateText2({
          model: provider.model,
          system: this.systemPrompt,
          messages: this.messages.slice(1),
          tools: aiTools,
          maxSteps: 1,
          abortSignal: options?.signal
        });
        if (result.usage) {
          this.usage.recordTokens(result.usage.promptTokens ?? 0, result.usage.completionTokens ?? 0);
          this.state.totalTokensUsed = this.usage.totalTokens;
          this.state.totalCost = this.usage.estimatedCost;
        }
        await this.runHook("onAfterLLMCall", { agentState: this.state, step: this.state.step, messages: this.messages });
        this.emit("llm:response", { step: this.state.step, tokensUsed: result.usage?.totalTokens });
        const stepInfo = {
          step: this.state.step,
          text: result.text || void 0,
          durationMs: Date.now() - stepStart,
          tokensUsed: result.usage ? { input: result.usage.promptTokens ?? 0, output: result.usage.completionTokens ?? 0 } : void 0
        };
        if (result.steps && result.steps.length > 0) {
          for (const sdkStep of result.steps) {
            if (sdkStep.toolCalls?.length) {
              stepInfo.toolCalls = sdkStep.toolCalls.map((tc) => ({ tool: tc.toolName, args: tc.args }));
            }
            if (sdkStep.toolResults?.length) {
              stepInfo.toolResults = sdkStep.toolResults.map((tr) => {
                const trAny = tr;
                return {
                  tool: trAny.toolName ?? trAny.tool ?? "unknown",
                  output: trAny.result ?? trAny.output,
                  error: trAny.error,
                  durationMs: 0,
                  approved: true
                };
              });
            }
          }
        } else if (result.toolCalls && result.toolCalls.length > 0) {
          stepInfo.toolCalls = result.toolCalls.map((tc) => ({ tool: tc.toolName, args: tc.args }));
        }
        if (result.response?.messages && result.response.messages.length > 0) {
          this.messages = [this.messages[0], ...result.response.messages];
          if (this.memoryMessageIdx >= 0) {
            this.memoryMessageIdx = 1;
          }
        } else {
          if (result.text) this.messages.push({ role: "assistant", content: result.text });
        }
        this.steps.push(stepInfo);
        this.usage.recordStep();
        this.state.step++;
        if (options?.onStep) options.onStep(stepInfo);
        this.emit("step", { step: this.state.step });
        return !!(result.toolCalls?.length || result.steps?.some((s) => s.toolCalls?.length));
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!this.router.shouldFallback(err)) throw lastError;
        this.emit("provider:fallback", { from: provider.id, error: lastError.message, step: this.state.step });
      }
    }
    throw lastError ?? new Error("All providers failed");
  }
  async executeStepStreaming(options) {
    const aiTools = this.buildAITools();
    await this.runHook("onBeforeLLMCall", { agentState: this.state, step: this.state.step, messages: this.messages });
    this.emit("llm:call", { step: this.state.step, messageCount: this.messages.length });
    const stepStart = Date.now();
    const fallbackChain = this.router.getFallbackChain();
    let lastError;
    for (const provider of fallbackChain) {
      try {
        const streamResults = streamText({
          model: provider.model,
          system: this.systemPrompt,
          messages: this.messages.slice(1),
          tools: aiTools,
          maxSteps: 1,
          abortSignal: options?.signal
        });
        let fullText = "";
        for await (const chunk of (await streamResults).textStream) {
          fullText += chunk;
          if (options?.onText) options.onText(chunk);
        }
        const consumed = await streamResults;
        const finalUsage = await consumed.usage;
        if (finalUsage) {
          this.usage.recordTokens(finalUsage.promptTokens ?? 0, finalUsage.completionTokens ?? 0);
          this.state.totalTokensUsed = this.usage.totalTokens;
          this.state.totalCost = this.usage.estimatedCost;
        }
        await this.runHook("onAfterLLMCall", { agentState: this.state, step: this.state.step, messages: this.messages });
        this.emit("llm:response", { step: this.state.step, tokensUsed: finalUsage?.totalTokens });
        const stepInfo = {
          step: this.state.step,
          text: fullText || void 0,
          durationMs: Date.now() - stepStart,
          tokensUsed: finalUsage ? { input: finalUsage.promptTokens ?? 0, output: finalUsage.completionTokens ?? 0 } : void 0
        };
        const stepsData = consumed.steps;
        if (stepsData?.length) {
          for (const sdkStep of stepsData) {
            if (sdkStep.toolCalls?.length) {
              stepInfo.toolCalls = sdkStep.toolCalls.map((tc) => ({ tool: tc.toolName, args: tc.args }));
            }
            if (sdkStep.toolResults?.length) {
              stepInfo.toolResults = sdkStep.toolResults.map((tr) => ({
                tool: tr.toolName ?? "unknown",
                output: tr.result ?? tr.output,
                error: tr.error,
                durationMs: 0,
                approved: true
              }));
            }
          }
        }
        const responseMsgs = consumed.response?.messages;
        if (responseMsgs?.length) {
          this.messages = [this.messages[0], ...responseMsgs];
          if (this.memoryMessageIdx >= 0) {
            this.memoryMessageIdx = 1;
          }
        } else if (fullText) {
          this.messages.push({ role: "assistant", content: fullText });
        }
        this.steps.push(stepInfo);
        this.usage.recordStep();
        this.state.step++;
        if (options?.onStep) options.onStep(stepInfo);
        this.emit("step", { step: this.state.step });
        const hasToolCalls = stepsData?.some((s) => s.toolCalls?.length) ?? consumed.toolCalls?.length > 0;
        return !!hasToolCalls;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!this.router.shouldFallback(err)) throw lastError;
        this.emit("provider:fallback", { from: provider.id, error: lastError.message, step: this.state.step });
      }
    }
    throw lastError ?? new Error("All providers failed");
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
    if (toolResult.output) toolResult.output = this.contextMgr.truncateToolOutput(toolResult.output, this.messages);
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
    await this.projectMemoryReady;
    this.state = this.createInitialState();
    this.steps = [];
    this.messages = [{ role: "system", content: await this.buildSystemPrompt() }];
    this.messages.push({ role: "user", content: prompt });
    this.usage.reset();
    this.guard.resetAllowAlways();
    this.contextMgr.adaptToProvider();
    this.tracer.reset();
    this.memoryMessageIdx = -1;
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
          execute: async (args) => {
            const call = { tool: toolDef.name, args };
            const result = await this.executeToolCall(call);
            if (result.error) return { error: result.error };
            return result.output;
          }
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
    const traceTypeMap = {
      "step": "step",
      "tool:call": "tool_call",
      "tool:result": "tool_result",
      "llm:call": "llm_call",
      "context:compressed": "compression",
      "skill:activated": "skill",
      "skill:deactivated": "skill",
      "provider:fallback": "provider_fallback"
    };
    const tracedType = traceTypeMap[type];
    if (tracedType) this.tracer.record(tracedType, data);
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

// src/errors.ts
var RETRY_STRATEGY = {
  // Provider — most are retryable
  PROVIDER_TIMEOUT: "backoff",
  PROVIDER_RATE_LIMIT: "after_cooldown",
  PROVIDER_AUTH: "never",
  PROVIDER_QUOTA: "after_cooldown",
  PROVIDER_MODEL_NOT_FOUND: "never",
  PROVIDER_SERVER_ERROR: "backoff",
  PROVIDER_NETWORK: "backoff",
  // Tool — some retryable
  TOOL_NOT_FOUND: "never",
  TOOL_VALIDATION: "never",
  TOOL_PERMISSION_DENIED: "never",
  TOOL_EXECUTION: "never",
  TOOL_TIMEOUT: "backoff",
  TOOL_ABORTED: "never",
  // Memory — generally not retryable
  MEMORY_STORAGE: "backoff",
  MEMORY_NOT_FOUND: "never",
  MEMORY_CORRUPTION: "never",
  // Context
  CONTEXT_OVERFLOW: "immediate",
  CONTEXT_COMPRESSION_FAILED: "never",
  // Limits — not retryable (need user action)
  LIMIT_STEPS: "never",
  LIMIT_TOKENS: "never",
  LIMIT_TOOL_CALLS: "never",
  LIMIT_TIMEOUT: "never",
  LIMIT_COST: "never",
  // Session
  SESSION_CONCURRENT: "after_cooldown",
  SESSION_NOT_FOUND: "never",
  SESSION_CORRUPTION: "never",
  // Config
  CONFIG_INVALID: "never",
  CONFIG_MISSING: "never"
};
var AgentError = class _AgentError extends Error {
  code;
  retry;
  cause;
  context;
  timestamp;
  constructor(options) {
    super(options.message);
    this.name = "AgentError";
    this.code = options.code;
    this.retry = RETRY_STRATEGY[options.code];
    this.cause = options.cause;
    this.context = options.context ?? {};
    this.timestamp = Date.now();
  }
  /** Check if this error is retryable */
  get retryable() {
    return this.retry !== "never";
  }
  /** Get recommended delay before retry (ms) */
  get retryDelayMs() {
    switch (this.retry) {
      case "immediate":
        return 0;
      case "backoff":
        return 1e3 + Math.random() * 2e3;
      case "after_cooldown":
        return 3e4 + Math.random() * 3e4;
      default:
        return Infinity;
    }
  }
  /** Serialize for logging/persistence */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retry: this.retry,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp,
      cause: this.cause?.message
    };
  }
  /** Create from an unknown thrown value */
  static from(err, code) {
    if (err instanceof _AgentError) return err;
    if (err instanceof Error) {
      return new _AgentError({
        code: code ?? inferCode(err),
        message: err.message,
        cause: err
      });
    }
    return new _AgentError({
      code: code ?? "TOOL_EXECUTION",
      message: String(err)
    });
  }
};
function inferCode(err) {
  const msg = err.message.toLowerCase();
  if (/timeout|timed out|etimedout/i.test(msg)) return "PROVIDER_TIMEOUT";
  if (/429|rate limit|too many requests/i.test(msg)) return "PROVIDER_RATE_LIMIT";
  if (/401|403|unauthorized|forbidden|invalid api key/i.test(msg)) return "PROVIDER_AUTH";
  if (/402|quota|billing|insufficient/i.test(msg)) return "PROVIDER_QUOTA";
  if (/404|model not found|does not exist/i.test(msg)) return "PROVIDER_MODEL_NOT_FOUND";
  if (/500|502|503|internal server|service unavailable/i.test(msg)) return "PROVIDER_SERVER_ERROR";
  if (/econnrefused|enotfound|network|fetch failed/i.test(msg)) return "PROVIDER_NETWORK";
  if (/unknown tool|tool not found/i.test(msg)) return "TOOL_NOT_FOUND";
  if (/invalid input|validation|parse/i.test(msg)) return "TOOL_VALIDATION";
  if (/permission denied|not allowed/i.test(msg)) return "TOOL_PERMISSION_DENIED";
  if (/abort/i.test(msg)) return "TOOL_ABORTED";
  if (/max steps|maxstep/i.test(msg)) return "LIMIT_STEPS";
  if (/max token/i.test(msg)) return "LIMIT_TOKENS";
  if (/timeout.*limit/i.test(msg)) return "LIMIT_TIMEOUT";
  return "TOOL_EXECUTION";
}
function isRetryable(err) {
  if (err instanceof AgentError) return err.retryable;
  return true;
}
function getRetryDelay(err) {
  if (err instanceof AgentError) return err.retryDelayMs;
  const code = inferCode(err instanceof Error ? err : new Error(String(err)));
  return RETRY_STRATEGY[code] === "never" ? Infinity : 2e3;
}
function wrapProviderError(err, providerId) {
  return AgentError.from(err, inferCode(err instanceof Error ? err : new Error(String(err))));
}
function toolError(tool, message, cause) {
  return new AgentError({
    code: "TOOL_EXECUTION",
    message: `Tool "${tool}" failed: ${message}`,
    cause,
    context: { tool }
  });
}

// src/session.ts
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
var DEFAULT_SESSION_CONFIG = {
  storageDir: "./sessions",
  persist: true,
  autoSaveIntervalMs: 3e4,
  maxConcurrentPerUser: 1
};
var UserSession = class _UserSession {
  userId;
  sessionId;
  messages = [];
  state;
  createdAt;
  updatedAt;
  metadata = {};
  /** Queue of pending runs — ensures serial execution per user */
  runQueue = [];
  running = false;
  constructor(userId, sessionId) {
    this.userId = userId;
    this.sessionId = sessionId ?? `sess_${userId}_${Date.now()}`;
    this.state = this.createInitialState();
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }
  /** Acquire run lock — returns a release function */
  async acquire() {
    if (!this.running) {
      this.running = true;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.runQueue.push(() => {
        this.running = true;
        resolve(() => this.release());
      });
    });
  }
  release() {
    this.running = false;
    this.updatedAt = Date.now();
    const next = this.runQueue.shift();
    if (next) next();
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
  resetState() {
    this.state = this.createInitialState();
    this.messages = [];
    this.updatedAt = Date.now();
  }
  toData() {
    return {
      sessionId: this.sessionId,
      userId: this.userId,
      messages: [...this.messages],
      state: { ...this.state },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: { ...this.metadata }
    };
  }
  static fromData(data) {
    const sess = new _UserSession(data.userId, data.sessionId);
    sess.messages = data.messages;
    sess.state = data.state;
    sess.createdAt = data.createdAt;
    sess.updatedAt = data.updatedAt;
    sess.metadata = data.metadata;
    return sess;
  }
};
var SessionManager = class {
  sessions = /* @__PURE__ */ new Map();
  // sessionId → UserSession
  userIndex = /* @__PURE__ */ new Map();
  // userId → sessionIds
  config;
  autoSaveTimer;
  constructor(config) {
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
    if (this.config.autoSaveIntervalMs > 0 && this.config.persist) {
      this.autoSaveTimer = setInterval(() => this.saveAll(), this.config.autoSaveIntervalMs);
    }
  }
  /** Create or get a session for a user */
  createSession(userId, sessionId) {
    const id = sessionId ?? `sess_${userId}_${Date.now()}`;
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const session = new UserSession(userId, id);
    this.sessions.set(id, session);
    if (!this.userIndex.has(userId)) {
      this.userIndex.set(userId, /* @__PURE__ */ new Set());
    }
    this.userIndex.get(userId).add(id);
    return session;
  }
  /** Get session by ID */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  /** Get all sessions for a user */
  getUserSessions(userId) {
    const ids = this.userIndex.get(userId);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.sessions.get(id)).filter((s) => s !== void 0);
  }
  /** Get or create the latest session for a user */
  getLatestSession(userId) {
    const sessions = this.getUserSessions(userId);
    if (sessions.length === 0) return this.createSession(userId);
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions[0];
  }
  /** Run a function with session lock (concurrent-safe) */
  async withSession(userId, fn) {
    const session = this.getLatestSession(userId);
    const release = await session.acquire();
    try {
      const result = await fn(session);
      if (this.config.persist) await this.saveSession(session);
      return result;
    } catch (err) {
      if (this.config.persist) await this.saveSession(session);
      throw err;
    } finally {
      release();
    }
  }
  /** Delete a session */
  async deleteSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    const userSessions = this.userIndex.get(session.userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) this.userIndex.delete(session.userId);
    }
    if (this.config.persist) {
      const filePath = this.getSessionPath(sessionId);
      if (existsSync(filePath)) {
        const { unlink } = await import("fs/promises");
        await unlink(filePath).catch(() => {
        });
      }
    }
  }
  // ─── Persistence ─────────────────────────────────────────────────
  /** Save a single session to disk */
  async saveSession(session) {
    if (!this.config.persist) return;
    const filePath = this.getSessionPath(session.sessionId);
    const dir = dirname(filePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify(session.toData(), null, 2), "utf-8");
  }
  /** Save all active sessions */
  async saveAll() {
    if (!this.config.persist) return;
    const saves = Array.from(this.sessions.values()).map((s) => this.saveSession(s).catch(() => {
    }));
    await Promise.all(saves);
  }
  /** Load a session from disk */
  async loadSession(sessionId) {
    const filePath = this.getSessionPath(sessionId);
    if (!existsSync(filePath)) return null;
    try {
      const data = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);
      const session = UserSession.fromData(parsed);
      this.sessions.set(sessionId, session);
      if (!this.userIndex.has(session.userId)) {
        this.userIndex.set(session.userId, /* @__PURE__ */ new Set());
      }
      this.userIndex.get(session.userId).add(sessionId);
      return session;
    } catch {
      throw new AgentError({
        code: "SESSION_CORRUPTION",
        message: `Session file corrupted: ${sessionId}`,
        context: { sessionId }
      });
    }
  }
  /** Load all sessions from storage directory */
  async loadAllSessions() {
    if (!existsSync(this.config.storageDir)) return 0;
    const { readdir } = await import("fs/promises");
    const files = await readdir(this.config.storageDir);
    let loaded = 0;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const sessionId = file.replace(".json", "");
      try {
        await this.loadSession(sessionId);
        loaded++;
      } catch {
      }
    }
    return loaded;
  }
  /** Graceful shutdown — save all and stop timer */
  async shutdown() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = void 0;
    }
    await this.saveAll();
  }
  getSessionPath(sessionId) {
    return join(this.config.storageDir, `${sessionId}.json`);
  }
};
export {
  Agent,
  AgentError,
  ContextManager,
  DEFAULT_CONTEXT_CONFIG,
  PROVIDER_PRICING,
  ResourceLimitError,
  SessionManager,
  SkillLoaderWorker,
  StructuredLogger,
  TraceCollector,
  TraceReplay,
  UsageTracker,
  createAgent,
  getPricing,
  getRetryDelay,
  isRetryable,
  toolError,
  wrapProviderError
};
//# sourceMappingURL=index.js.map