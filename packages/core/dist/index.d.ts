import { ToolDefinition, ToolCall, ToolResult } from '@agentnova/tools';
import { ResourceLimits, PermissionConfig } from '@agentnova/permission';
import { CoreMessage } from 'ai';
import { ProviderRouter } from '@agentnova/providers';
import { LongTermMemoryConfig } from '@agentnova/memory';

interface TokenPrice {
    inputPer1M: number;
    outputPer1M: number;
}
interface UsageSnapshot {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    toolCallCount: number;
    stepCount: number;
    durationMs: number;
}
declare class UsageTracker {
    private price;
    private limits;
    private inputTokens;
    private outputTokens;
    private toolCallCount;
    private stepCount;
    private startTime;
    constructor(price: TokenPrice, limits: ResourceLimits);
    /** Record token usage from an LLM call */
    recordTokens(input: number, output: number): void;
    /** Record a tool call */
    recordToolCall(): void;
    /** Record a step completion */
    recordStep(): void;
    /** Check if any limit has been exceeded */
    isLimitExceeded(): {
        exceeded: boolean;
        reason?: string;
    };
    /** Throw if limit exceeded */
    assertWithinLimits(): void;
    get totalTokens(): number;
    get estimatedCost(): number;
    get elapsedMs(): number;
    /** Get a snapshot of current usage */
    snapshot(): UsageSnapshot;
    /** Reset tracker (for new runs) */
    reset(): void;
}
declare class ResourceLimitError extends Error {
    constructor(reason: string);
}
declare const PROVIDER_PRICING: Record<string, TokenPrice>;
/** Get pricing for a provider, supports provider:model exact match with provider fallback */
declare function getPricing(providerId: string): TokenPrice;

type AgentEventName = 'agent:start' | 'agent:end' | 'agent:error' | 'llm:call' | 'llm:response' | 'tool:call' | 'tool:result' | 'tool:approved' | 'tool:denied' | 'context:compressed' | 'memory:stored' | 'memory:retrieved' | 'skill:activated' | 'skill:deactivated' | 'provider:fallback' | 'step';
interface AgentEvent {
    type: AgentEventName;
    timestamp: number;
    data: Record<string, unknown>;
}
type EventHandler = (event: AgentEvent) => void;
type HookName = 'onStart' | 'onBeforeLLMCall' | 'onAfterLLMCall' | 'onBeforeToolCall' | 'onAfterToolCall' | 'onEnd' | 'onError';
interface HookContext {
    agentState: AgentState;
    step: number;
    messages?: CoreMessage[];
    toolCall?: ToolCall;
    toolResult?: ToolResult;
    modified?: boolean;
}
type HookFn = (ctx: HookContext) => Promise<void | {
    action?: 'deny';
    reason?: string;
}>;
type CompressionStrategy = 'summary' | 'sliding-window' | 'hybrid';
interface ContextConfig {
    /** Number of recent turns to preserve without compression */
    preserveRecentTurns: number;
    /** Token threshold to trigger compression (fraction of contextWindow) */
    compressionTriggerRatio: number;
    /** Compression strategy */
    compressionStrategy: CompressionStrategy;
    /** Max tool output length before truncation */
    maxToolOutputLength: number;
    /** Truncation strategy for tool output */
    toolOutputTruncate: 'tail' | 'head';
    /** Per-provider context window overrides */
    contextWindowOverrides?: Record<string, number>;
    /** Maximum tokens for auto-summaries (default: 1000) */
    maxSummaryTokens?: number;
    /** Preemptive compression threshold — compress when projected to exceed (default: 0.85) */
    preemptiveThreshold?: number;
}
interface AgentState {
    step: number;
    totalTokensUsed: number;
    totalCost: number;
    startTime: number;
    toolCallCount: number;
    aborted: boolean;
    messages: CoreMessage[];
}
interface AgentConfig {
    /** System prompt / identity */
    systemPrompt: string;
    /** Working directory for file operations */
    workingDir: string;
    /** Provider router */
    router: ProviderRouter;
    /** Tools to register */
    tools: ToolDefinition[];
    /** Permission configuration */
    permissions?: Partial<PermissionConfig>;
    /** Context management configuration */
    context?: Partial<ContextConfig>;
    /** Long-term memory configuration (SQLite-backed) */
    longTermMemory?: LongTermMemoryConfig;
    /** Skill directories to load */
    skillDirs?: string[];
    /** Custom model for this agent (overrides router default) */
    model?: string;
}
interface AgentRunOptions {
    /** Abort signal for cancellation */
    signal?: AbortSignal;
    /** Callback for each step */
    onStep?: (step: StepInfo) => void;
    /** Streaming callback for text output */
    onText?: (text: string) => void;
    /** Max steps override for this run */
    maxSteps?: number;
}
interface StepInfo {
    step: number;
    text?: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    tokensUsed?: {
        input: number;
        output: number;
    };
    durationMs: number;
}
interface AgentResult {
    text: string;
    messages: CoreMessage[];
    state: AgentState;
    steps: StepInfo[];
    totalDurationMs: number;
    usage?: UsageSnapshot;
}

interface TraceEntry {
    type: 'step' | 'tool_call' | 'tool_result' | 'llm_call' | 'compression' | 'skill' | 'provider_fallback';
    timestamp: number;
    data: Record<string, unknown>;
}
interface Trace {
    id: string;
    startTime: number;
    endTime: number;
    entries: TraceEntry[];
    steps: StepInfo[];
    totalTokens: number;
    totalCost: number;
    provider: string;
}
declare class TraceCollector {
    private entries;
    private startTime;
    private traceId;
    private providerId;
    constructor(providerId: string);
    /** Record a trace entry */
    record(type: TraceEntry['type'], data: Record<string, unknown>): void;
    /** Build final trace snapshot */
    buildTrace(steps: StepInfo[], totalTokens: number, totalCost: number): Trace;
    /** Reset for new run */
    reset(providerId?: string): void;
    /** Get raw entries (for streaming consumption) */
    getEntries(): ReadonlyArray<TraceEntry>;
}
declare class TraceReplay {
    private trace;
    constructor(trace: Trace);
    /** Replay trace step by step */
    replay(options?: {
        onStep?: (entry: TraceEntry, index: number) => void;
        delayMs?: number;
    }): Promise<void>;
    /** Get summary string */
    summary(): string;
    /** Export as JSON */
    toJSON(): string;
}
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Production Logger — file output, level filtering, sampling, rotation
 */
interface LoggerConfig {
    /** Minimum log level (default: 'info') */
    minLevel?: LogLevel;
    /** Whether to also output to console (default: true in dev, false in prod) */
    console?: boolean;
    /** Log file path (default: no file output) */
    filePath?: string;
    /** Maximum log file size in bytes before rotation (default: 10MB) */
    maxFileSize?: number;
    /** Number of rotated log files to keep (default: 3) */
    maxFiles?: number;
    /** Sampling rate for debug/info logs: 1 = every, 10 = every 10th (default: 1) */
    samplingRate?: number;
    /** Trace ID for correlation */
    traceId?: string;
}
interface LogEntry {
    level: LogLevel;
    timestamp: number;
    message: string;
    data?: Record<string, unknown>;
    traceId?: string;
}
declare class StructuredLogger {
    private logs;
    private minLevel;
    private consoleOutput;
    private filePath?;
    private maxFileSize;
    private maxFiles;
    private samplingRate;
    private traceId?;
    private writeQueue;
    private logCounts;
    constructor(config?: LoggerConfig);
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
    private log;
    private writeToFile;
    private rotateLogs;
    /** Get all logs (in-memory) */
    getLogs(level?: LogLevel): ReadonlyArray<LogEntry>;
    /** Export as newline-delimited JSON */
    exportNDJSON(): string;
    /** Clear in-memory logs */
    clear(): void;
    /** Set trace ID */
    setTraceId(id: string): void;
}

declare class Agent {
    private registry;
    private engine;
    private guard;
    private router;
    private contextMgr;
    private usage;
    private tracer;
    private logger;
    private systemPrompt;
    private workingDir;
    private permissions;
    private limits;
    private contextConfig;
    private state;
    private messages;
    private workingMemory;
    private projectMemory;
    private longTermMemory?;
    private memoryInjector;
    private projectMemoryReady;
    private skills;
    private skillDirs;
    private hooks;
    private eventHandlers;
    private steps;
    constructor(config: AgentConfig);
    /** Build enriched system prompt with memory and skills context */
    private buildSystemPrompt;
    private createInitialState;
    /** Run the agent with a user prompt (non-streaming) */
    run(prompt: string, options?: AgentRunOptions): Promise<AgentResult>;
    /** Run the agent with streaming output */
    runStream(prompt: string, options?: AgentRunOptions): Promise<AgentResult>;
    registerTool(tool: ToolDefinition): void;
    hook(name: HookName, fn: HookFn): void;
    on(event: AgentEventName, handler: EventHandler): void;
    getState(): Readonly<AgentState>;
    getUsage(): UsageSnapshot;
    abort(): void;
    /** Get execution trace */
    getTrace(): Trace;
    /** Get trace replay */
    replayTrace(): TraceReplay;
    /** Get structured logger */
    getLogger(): StructuredLogger;
    /** Store a memory item */
    remember(key: string, content: string, layer?: 'working' | 'project' | 'longterm'): Promise<void>;
    private memoryMessageIdx;
    private injectMemories;
    private executeStep;
    private executeStepStreaming;
    private executeToolCall;
    private buildResult;
    private resetState;
    private buildAITools;
    private runHook;
    private emit;
    private getSnapshot;
    private extractFinalText;
}
declare function createAgent(config: AgentConfig): Agent;

/**
 * Lightweight wrapper around SkillLoader.
 * Extracted from agent.ts to keep concerns separate.
 */
declare class SkillLoaderWorker {
    private skills;
    loadAll(dirs: string[]): Promise<void>;
    activateForInput(input: string): Array<{
        name: string;
        active: boolean;
    }>;
    getActiveTools(): ToolDefinition[];
    getActivePrompts(): string[];
}

/**
 * Compression result with metadata for observability
 */
interface CompressionResult {
    messages: CoreMessage[];
    originalTokenCount: number;
    compressedTokenCount: number;
    strategy: CompressionStrategy;
    summarized?: boolean;
    droppedCount: number;
}
/**
 * Token budget breakdown — used for intelligent allocation
 */
interface TokenBudget {
    /** Total context window */
    window: number;
    /** Usable tokens (after system prompt + response reserve) */
    usable: number;
    /** Currently consumed tokens */
    consumed: number;
    /** Remaining tokens */
    remaining: number;
    /** Tokens needed for next LLM response (estimate) */
    responseReserve: number;
}
/**
 * Context Manager — production-grade context compression
 *
 * Key improvements over v1:
 * 1. LLM-powered summarization with pronoun resolution (no external summarizer needed)
 * 2. Adaptive memory injection based on remaining budget
 * 3. Progressive compression instead of all-or-nothing
 * 4. Semantic prioritization: references, errors, user decisions get higher priority
 * 5. Token-budget-aware tool output truncation
 */
declare class ContextManager {
    private router;
    private config;
    constructor(config: ContextConfig, router: ProviderRouter);
    /**
     * Estimate token count for messages.
     * Uses a heuristic: ~4 chars per token for English, ~2 chars per token for CJK.
     * Falls back to 3.5 chars/token average for mixed content.
     */
    estimateTokens(messages: CoreMessage[]): number;
    /** Estimate tokens for a single text string */
    estimateTextTokens(text: string): number;
    /** Get the context window size for the current default provider */
    getContextWindow(): number;
    /** Get usable context (reserve space for system prompt + response) */
    getUsableContext(): number;
    /** Calculate current token budget */
    getBudget(messages: CoreMessage[]): TokenBudget;
    /** Check if compression is needed */
    needsCompression(messages: CoreMessage[]): boolean;
    /** Calculate how much we need to compress (0-1) */
    compressionRatio(messages: CoreMessage[]): number;
    /**
     * Calculate how many memory items can be injected given current budget.
     * Returns { topK, maxItemLength } — adaptively scales down when tight.
     */
    calculateMemoryBudget(messages: CoreMessage[], requestedTopK: number): {
        topK: number;
        maxItemLength: number;
        budgetRemaining: number;
    };
    /**
     * Compress messages with full metadata tracking.
     * Now supports auto-LLM summarization when no external summarizer is provided.
     */
    compress(messages: CoreMessage[], summarizer?: (text: string) => Promise<string>): Promise<CoreMessage[]>;
    /**
     * Full compression with observability metadata.
     */
    compressWithMeta(messages: CoreMessage[], externalSummarizer?: (text: string) => Promise<string>): Promise<CompressionResult>;
    /**
     * Proactively compress after a tool call that returns large output.
     * Called by Agent before the tool result is added to messages.
     */
    compressAfterToolCall(messages: CoreMessage[], toolOutputTokens: number, summarizer?: (text: string) => Promise<string>): Promise<CoreMessage[]>;
    /** Truncate a tool output to fit budget, with awareness of remaining space */
    truncateToolOutput(output: unknown, messages?: CoreMessage[]): string;
    /**
     * Assign priority to a message based on semantic content analysis.
     * This is much smarter than the v1 version that only looked at role.
     */
    messagePriority(msg: CoreMessage): number;
    /** Annotate messages with semantic metadata for smarter compression */
    private annotateMessages;
    /**
     * Extract key messages using semantic annotations.
     * Much smarter than v1 — preserves error info, pronoun references, and user decisions.
     */
    private extractKeyMessages;
    /** Alias for backward compat */
    private extractKeyMessagesSemantic;
    /**
     * Summarize a block of messages.
     * Strategy:
     * 1. If external summarizer provided, use it
     * 2. Otherwise, try using the Agent's own LLM (via router) for auto-summarization
     * 3. If neither works, fall back to semantic extraction
     */
    private summarizeBlock;
    /** Format messages for summarization input */
    private formatMessagesForSummary;
    /** Build a summary message with standard format */
    private buildSummaryMessage;
    /** Split messages at the N-th most recent turn boundary */
    private splitMessages;
    /** Extract plain text from a message */
    private extractText;
    /**
     * Adapt compression settings based on the current provider.
     * Called when the active provider changes.
     */
    adaptToProvider(): void;
}
declare const DEFAULT_CONTEXT_CONFIG: ContextConfig;

/**
 * Structured Error System — production-grade error handling
 *
 * All Agent errors carry a machine-readable code, retry strategy,
 * and contextual metadata. No more string matching on error messages.
 */
type ErrorCode = 'PROVIDER_TIMEOUT' | 'PROVIDER_RATE_LIMIT' | 'PROVIDER_AUTH' | 'PROVIDER_QUOTA' | 'PROVIDER_MODEL_NOT_FOUND' | 'PROVIDER_SERVER_ERROR' | 'PROVIDER_NETWORK' | 'TOOL_NOT_FOUND' | 'TOOL_VALIDATION' | 'TOOL_PERMISSION_DENIED' | 'TOOL_EXECUTION' | 'TOOL_TIMEOUT' | 'TOOL_ABORTED' | 'MEMORY_STORAGE' | 'MEMORY_NOT_FOUND' | 'MEMORY_CORRUPTION' | 'CONTEXT_OVERFLOW' | 'CONTEXT_COMPRESSION_FAILED' | 'LIMIT_STEPS' | 'LIMIT_TOKENS' | 'LIMIT_TOOL_CALLS' | 'LIMIT_TIMEOUT' | 'LIMIT_COST' | 'SESSION_CONCURRENT' | 'SESSION_NOT_FOUND' | 'SESSION_CORRUPTION' | 'CONFIG_INVALID' | 'CONFIG_MISSING';
type RetryCategory = 'never' | 'immediate' | 'backoff' | 'after_cooldown';
declare class AgentError extends Error {
    readonly code: ErrorCode;
    readonly retry: RetryCategory;
    readonly cause?: Error;
    readonly context: Record<string, unknown>;
    readonly timestamp: number;
    constructor(options: {
        code: ErrorCode;
        message: string;
        cause?: Error;
        context?: Record<string, unknown>;
    });
    /** Check if this error is retryable */
    get retryable(): boolean;
    /** Get recommended delay before retry (ms) */
    get retryDelayMs(): number;
    /** Serialize for logging/persistence */
    toJSON(): Record<string, unknown>;
    /** Create from an unknown thrown value */
    static from(err: unknown, code?: ErrorCode): AgentError;
}
/** Check if an error is retryable */
declare function isRetryable(err: unknown): boolean;
/** Get recommended retry delay */
declare function getRetryDelay(err: unknown): number;
/** Wrap a provider error with structured code */
declare function wrapProviderError(err: unknown, providerId?: string): AgentError;
/** Create a tool execution error */
declare function toolError(tool: string, message: string, cause?: Error): AgentError;

/**
 * Session Manager — concurrency safety + user-scoped data isolation
 *
 * Guarantees:
 * 1. Same Agent instance can serve multiple users concurrently
 * 2. Each user gets isolated messages, memory, state
 * 3. Same user gets concurrent lock (queue, not crash)
 * 4. Sessions persist to disk and can be restored
 */

interface SessionData {
    sessionId: string;
    userId: string;
    messages: CoreMessage[];
    state: AgentState;
    createdAt: number;
    updatedAt: number;
    metadata: Record<string, unknown>;
}
interface SessionConfig {
    /** Directory for session persistence (default: ./sessions) */
    storageDir: string;
    /** Whether to persist sessions to disk (default: true) */
    persist: boolean;
    /** Auto-save interval in ms (0 = disabled, default: 30000) */
    autoSaveIntervalMs: number;
    /** Maximum concurrent runs per user (default: 1 — queue) */
    maxConcurrentPerUser: number;
}
declare class UserSession {
    readonly userId: string;
    readonly sessionId: string;
    messages: CoreMessage[];
    state: AgentState;
    createdAt: number;
    updatedAt: number;
    metadata: Record<string, unknown>;
    /** Queue of pending runs — ensures serial execution per user */
    private runQueue;
    private running;
    constructor(userId: string, sessionId?: string);
    /** Acquire run lock — returns a release function */
    acquire(): Promise<() => void>;
    private release;
    private createInitialState;
    resetState(): void;
    toData(): SessionData;
    static fromData(data: SessionData): UserSession;
}
declare class SessionManager {
    private sessions;
    private userIndex;
    private config;
    private autoSaveTimer?;
    constructor(config?: Partial<SessionConfig>);
    /** Create or get a session for a user */
    createSession(userId: string, sessionId?: string): UserSession;
    /** Get session by ID */
    getSession(sessionId: string): UserSession | undefined;
    /** Get all sessions for a user */
    getUserSessions(userId: string): UserSession[];
    /** Get or create the latest session for a user */
    getLatestSession(userId: string): UserSession;
    /** Run a function with session lock (concurrent-safe) */
    withSession<T>(userId: string, fn: (session: UserSession) => Promise<T>): Promise<T>;
    /** Delete a session */
    deleteSession(sessionId: string): Promise<void>;
    /** Save a single session to disk */
    saveSession(session: UserSession): Promise<void>;
    /** Save all active sessions */
    saveAll(): Promise<void>;
    /** Load a session from disk */
    loadSession(sessionId: string): Promise<UserSession | null>;
    /** Load all sessions from storage directory */
    loadAllSessions(): Promise<number>;
    /** Graceful shutdown — save all and stop timer */
    shutdown(): Promise<void>;
    private getSessionPath;
}

export { Agent, type AgentConfig, AgentError, type AgentEvent, type AgentEventName, type AgentResult, type AgentRunOptions, type AgentState, type CompressionResult, type CompressionStrategy, type ContextConfig, ContextManager, DEFAULT_CONTEXT_CONFIG, type ErrorCode, type EventHandler, type HookContext, type HookFn, type HookName, type LogEntry, type LogLevel, PROVIDER_PRICING, ResourceLimitError, type RetryCategory, type SessionConfig, type SessionData, SessionManager, SkillLoaderWorker, type StepInfo, StructuredLogger, type TokenPrice, type Trace, TraceCollector, type TraceEntry, TraceReplay, type UsageSnapshot, UsageTracker, createAgent, getPricing, getRetryDelay, isRetryable, toolError, wrapProviderError };
