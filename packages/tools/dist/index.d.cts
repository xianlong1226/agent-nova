import { z } from 'zod';

type PermissionLevel = 'read' | 'write' | 'dangerous';
interface ToolPermission {
    level: PermissionLevel;
    scope?: string[];
    description?: string;
}
interface ApprovalRequest {
    tool: string;
    args: Record<string, unknown>;
    permission: ToolPermission;
    reason?: string;
}
type ApprovalResult = 'allow-once' | 'allow-always' | 'deny';
type ApprovalFn = (request: ApprovalRequest) => Promise<ApprovalResult>;
interface AgentStateSnapshot {
    step: number;
    totalTokensUsed: number;
    startTime: number;
}
interface ToolLogger {
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
}
interface ToolContext {
    agentState: Readonly<AgentStateSnapshot>;
    workingDir: string;
    abortSignal: AbortSignal;
    askApproval: ApprovalFn;
    logger: ToolLogger;
}
interface ToolDefinition<TInput = any, TOutput = any> {
    name: string;
    description: string;
    parameters: z.ZodTypeAny;
    permission: ToolPermission;
    execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}
interface ToolCall {
    tool: string;
    args: Record<string, unknown>;
}
interface ToolResult {
    tool: string;
    output: unknown;
    error?: string;
    durationMs: number;
    approved: boolean;
}
declare function defineTool<TInput = any, TOutput = any>(def: ToolDefinition<TInput, TOutput>): ToolDefinition<TInput, TOutput>;

declare class ToolRegistry {
    private tools;
    /** Register a tool definition */
    register(tool: ToolDefinition): void;
    /** Register multiple tools at once */
    registerAll(tools: ToolDefinition[]): void;
    /** Get a tool by name */
    get(name: string): ToolDefinition | undefined;
    /** Check if a tool exists */
    has(name: string): boolean;
    /** List all registered tool names */
    list(): string[];
    /** Get all registered tools */
    getAll(): ToolDefinition[];
    /** Get tool definitions formatted for LLM consumption */
    getToolSchemas(): Record<string, {
        description: string;
        parameters: unknown;
    }>;
    /** Unregister a tool */
    unregister(name: string): boolean;
    /** Clear all tools */
    clear(): void;
}
declare class ToolEngine {
    private registry;
    constructor(registry: ToolRegistry);
    /** Execute a tool call with context */
    execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
    /** Get the underlying registry */
    getRegistry(): ToolRegistry;
}

declare const readFile: ToolDefinition<{
    path: string;
    encoding: string;
}, {
    content: string;
    path: string;
}>;
declare const writeFile: ToolDefinition<{
    path: string;
    content: string;
}, {
    success: boolean;
    path: string;
    bytesWritten: number;
}>;
declare const listDir: ToolDefinition<{
    path: string;
    recursive: boolean;
}, {
    name: string;
    type: "file" | "dir";
    path: string;
}[]>;
declare const fsStat: ToolDefinition<{
    path: string;
}, {
    path: string;
    type: string;
    size: number;
    modified: string;
    created: string;
}>;
declare const fsTools: (ToolDefinition<{
    path: string;
    encoding: string;
}, {
    content: string;
    path: string;
}> | ToolDefinition<{
    path: string;
    content: string;
}, {
    success: boolean;
    path: string;
    bytesWritten: number;
}> | ToolDefinition<{
    path: string;
    recursive: boolean;
}, {
    name: string;
    type: "file" | "dir";
    path: string;
}[]> | ToolDefinition<{
    path: string;
}, {
    path: string;
    type: string;
    size: number;
    modified: string;
    created: string;
}>)[];

declare const shellExec: ToolDefinition<{
    command: string;
    cwd?: string;
    timeout: number;
}, unknown>;
declare const shellTools: ToolDefinition<{
    command: string;
    cwd?: string;
    timeout: number;
}, unknown>[];

export { type AgentStateSnapshot, type ApprovalFn, type ApprovalRequest, type ApprovalResult, type PermissionLevel, type ToolCall, type ToolContext, type ToolDefinition, ToolEngine, type ToolLogger, type ToolPermission, ToolRegistry, type ToolResult, defineTool, fsStat, fsTools, listDir, readFile, shellExec, shellTools, writeFile };
