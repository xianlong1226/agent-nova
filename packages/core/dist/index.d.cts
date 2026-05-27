import { ToolDefinition, ToolCall, ToolResult } from '@agentnova/tools';
import { PermissionConfig } from '@agentnova/permission';
import { ProviderRouter } from '@agentnova/providers';
import { CoreMessage } from 'ai';

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
}

declare class Agent {
    private registry;
    private engine;
    private guard;
    private router;
    private contextMgr;
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
    run(prompt: string, options?: AgentRunOptions): Promise<AgentResult>;
    registerTool(tool: ToolDefinition): void;
    hook(name: HookName, fn: HookFn): void;
    on(event: AgentEventName, handler: EventHandler): void;
    getState(): Readonly<AgentState>;
    private buildAITools;
    private runHook;
    private emit;
    private getSnapshot;
    private extractFinalText;
}
declare function createAgent(config: AgentConfig): Agent;

/**
 * Context Manager — keeps the conversation within token budget
 * by compressing older messages and truncating tool output.
 */
declare const DEFAULT_CONTEXT_CONFIG: ContextConfig;
declare class ContextManager {
    private router;
    private config;
    constructor(config: ContextConfig, router: ProviderRouter);
    /** Estimate token count for messages (rough: 1 token ≈ 4 chars) */
    estimateTokens(messages: CoreMessage[]): number;
    /** Get the context window size for current provider */
    getContextWindow(): number;
    /** Check if compression is needed */
    needsCompression(messages: CoreMessage[]): boolean;
    /**
     * Compress messages if needed.
     * Returns potentially reduced message array.
     */
    compress(messages: CoreMessage[], summarizer?: (text: string) => Promise<string>): Promise<CoreMessage[]>;
    /** Truncate a tool output to fit budget */
    truncateToolOutput(output: unknown): string;
    /** Split messages at the N-th most recent turn boundary */
    private splitMessages;
    /** Summarize a block of older messages */
    private summarizeMessages;
    /** Extract key messages (user + assistant without large tool results) */
    private extractKeyMessages;
}

export { Agent, type AgentConfig, type AgentEvent, type AgentEventName, type AgentResult, type AgentRunOptions, type AgentState, type CompressionStrategy, type ContextConfig, ContextManager, DEFAULT_CONTEXT_CONFIG, type EventHandler, type HookContext, type HookFn, type HookName, type StepInfo, createAgent };
