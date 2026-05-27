import { ToolDefinition, ToolCall, ToolResult } from '@agentnova/tools';
import { ResourceLimits, PermissionConfig } from '@agentnova/permission';
import { CoreMessage } from 'ai';
import { ProviderRouter } from '@agentnova/providers';

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
/** Get pricing for a provider, fallback to GPT-4o pricing */
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

declare class Agent {
    private registry;
    private engine;
    private guard;
    private router;
    private contextMgr;
    private usage;
    private systemPrompt;
    private workingDir;
    private permissions;
    private limits;
    private contextConfig;
    private state;
    private messages;
    private hooks;
    private eventHandlers;
    private steps;
    constructor(config: AgentConfig);
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
    private executeStep;
    private executeStepStreaming;
    private processStepResult;
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
 * Context Manager — keeps the conversation within token budget
 * by compressing older messages, truncating tool output,
 * and dynamically adapting to the current provider's context window.
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
    /** Check if compression is needed */
    needsCompression(messages: CoreMessage[]): boolean;
    /** Calculate how much we need to compress (0-1) */
    compressionRatio(messages: CoreMessage[]): number;
    /**
     * Compress messages if needed.
     * Returns potentially reduced message array.
     */
    compress(messages: CoreMessage[], summarizer?: (text: string) => Promise<string>): Promise<CoreMessage[]>;
    /** Truncate a tool output to fit budget */
    truncateToolOutput(output: unknown): string;
    /** Assign priority to a message (higher = more important to keep) */
    messagePriority(msg: CoreMessage): number;
    /** Split messages at the N-th most recent turn boundary */
    private splitMessages;
    /** Summarize a block of older messages using LLM */
    private summarizeMessages;
    /** Extract key messages (user + assistant, compress tool results) */
    private extractKeyMessages;
    /** Extract plain text from a message */
    private extractText;
    /**
     * Adapt compression settings based on the current provider.
     * Called when the active provider changes.
     */
    adaptToProvider(): void;
}
declare const DEFAULT_CONTEXT_CONFIG: ContextConfig;

export { Agent, type AgentConfig, type AgentEvent, type AgentEventName, type AgentResult, type AgentRunOptions, type AgentState, type CompressionStrategy, type ContextConfig, ContextManager, DEFAULT_CONTEXT_CONFIG, type EventHandler, type HookContext, type HookFn, type HookName, PROVIDER_PRICING, ResourceLimitError, type StepInfo, type TokenPrice, type UsageSnapshot, UsageTracker, createAgent, getPricing };
