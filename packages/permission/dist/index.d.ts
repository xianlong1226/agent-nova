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
declare const DEFAULT_PERMISSION_CONFIG: PermissionConfig;
declare class PermissionGuard {
    private rules;
    private defaultMode;
    private approvalFn;
    constructor(config: PermissionConfig);
    getEffectiveMode(toolName: string, toolLevel: PermissionLevel): PermissionMode;
    check(request: ApprovalRequest): Promise<ApprovalResult>;
    private matchToolPattern;
}

export { type ApprovalFn, type ApprovalRequest, type ApprovalResult, DEFAULT_LIMITS, DEFAULT_PERMISSION_CONFIG, type PermissionConfig, PermissionGuard, type PermissionLevel, type PermissionMode, type PermissionRule, type ResourceLimits, type SandboxConfig, type ToolPermission };
