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
type PermissionMode = 'allow' | 'ask' | 'deny';
interface PermissionRule {
    tool: string;
    mode: PermissionMode;
    scope?: string[];
}
interface SandboxConfig {
    cwd?: string;
    allowedDirs?: string[];
    blockedCommands?: string[];
    blockedCommandPatterns?: string[];
    maxFileSize?: number;
    maxOutputLength?: number;
}
interface ResourceLimits {
    maxSteps: number;
    maxTokens: number;
    maxToolCalls: number;
    timeoutMs: number;
    maxFileSize: number;
}
declare const DEFAULT_LIMITS: ResourceLimits;
interface PermissionConfig {
    mode: PermissionMode;
    rules: PermissionRule[];
    onApprovalNeeded?: ApprovalFn;
    sandbox?: SandboxConfig;
    limits: ResourceLimits;
}
declare const DEFAULT_SANDBOX: SandboxConfig;
declare const DEFAULT_PERMISSION_CONFIG: PermissionConfig;
declare class PermissionGuard {
    private rules;
    private defaultMode;
    private approvalFn;
    private sandbox;
    private alwaysAllowed;
    constructor(config: PermissionConfig);
    getEffectiveMode(toolName: string, toolLevel: PermissionLevel): PermissionMode;
    check(request: ApprovalRequest): Promise<ApprovalResult>;
    /** Validate file path against sandbox allowedDirs */
    private isPathBlocked;
    /** Check command against blocked list and patterns */
    private isCommandBlocked;
    /** Check if file write exceeds maxFileSize */
    private isFileSizeExceeded;
    /** Remember an allow-always decision */
    private rememberAllowAlways;
    /** Resolve path relative to sandbox cwd */
    private resolvePath;
    /** Match tool name against pattern (supports * and namespace.*) */
    private matchToolPattern;
    /** Reset always-allowed cache */
    resetAllowAlways(): void;
    /** Get current sandbox config (read-only) */
    getSandbox(): Readonly<SandboxConfig>;
}

export { type ApprovalFn, type ApprovalRequest, type ApprovalResult, DEFAULT_LIMITS, DEFAULT_PERMISSION_CONFIG, DEFAULT_SANDBOX, type PermissionConfig, PermissionGuard, type PermissionLevel, type PermissionMode, type PermissionRule, type ResourceLimits, type SandboxConfig, type ToolPermission };
