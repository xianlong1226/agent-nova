// AgentNova — Unified entry point
// Re-exports everything from sub-packages for convenience

// Core
export { Agent, createAgent } from '@agentnova/core'
export type {
  AgentConfig,
  AgentRunOptions,
  AgentResult,
  AgentState,
  StepInfo,
  AgentEvent,
  AgentEventName,
  EventHandler,
  HookName,
  HookFn,
  HookContext,
  ContextConfig,
  CompressionStrategy,
} from '@agentnova/core'

// Trace & Logging (Phase 4)
export {
  TraceCollector,
  TraceReplay,
  StructuredLogger,
} from '@agentnova/core'
export type {
  Trace,
  TraceEntry,
  LogEntry,
  LogLevel,
} from '@agentnova/core'

// Session
export { SessionManager } from '@agentnova/core'
export type { SessionData, SessionConfig } from '@agentnova/core'

// Tools
export { ToolRegistry, ToolEngine, defineTool } from '@agentnova/tools'
export { fsTools, shellTools } from '@agentnova/tools'
export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
} from '@agentnova/tools'

// Permission
export { PermissionGuard, DEFAULT_PERMISSION_CONFIG } from '@agentnova/permission'

// Contracts (single source of truth for permission/tools/sandbox/limits types)
export {
  DEFAULT_LIMITS,
  DEFAULT_SANDBOX,
  LEVEL_DEFAULT_MODE,
} from '@agentnova/contracts'
export type {
  ToolPermission,
  PermissionLevel,
  ApprovalFn,
  ApprovalRequest,
  ApprovalResult,
  PermissionMode,
  PermissionRule,
  PermissionConfig,
  SandboxConfig,
  ResourceLimits,
  ToolPreflight,
  ToolPreflightCtx,
  PreflightResult,
} from '@agentnova/contracts'

// Memory
export {
  WorkingMemory,
  ProjectMemory,
  LongTermMemory,
  MemoryInjector,
} from '@agentnova/memory'
export type { MemoryStore, MemoryItem, LongTermMemoryConfig } from '@agentnova/memory'

// Errors
export {
  AgentError,
  isRetryable,
  getRetryDelay,
  wrapProviderError,
  toolError,
} from '@agentnova/core'
export type { ErrorCode, RetryCategory } from '@agentnova/core'

// Skills
export { SkillLoader, SkillRegistry, defineSkill } from '@agentnova/skills'
export type { SkillConfig, Skill, SkillManifest } from '@agentnova/skills'

// Providers
export { ProviderRouter, createRouter, RateLimiter } from '@agentnova/providers'
export {
  createOpenAICompatibleProvider,
  openaiGPT4o,
  deepseekChat,
  qwenMax,
  claudeSonnet4,
  claudeHaiku35,
} from '@agentnova/providers'
export type {
  ProviderConfig,
  RoutingConfig,
  TaskComplexity,
  ProviderId,
  RateLimiterConfig,
} from '@agentnova/providers'

// Convenience: Quick create with sensible defaults
import { createAgent } from '@agentnova/core'
import { fsTools, shellTools } from '@agentnova/tools'
import { DEFAULT_PERMISSION_CONFIG } from '@agentnova/permission'
import type { AgentConfig } from '@agentnova/core'
import type { ProviderRouter } from '@agentnova/providers'
import type { ToolDefinition } from '@agentnova/tools'
import type { DeepPartial } from './types.js'
export type { DeepPartial } from './types.js'

interface QuickAgentConfig {
  /** Model provider ID (e.g. 'deepseek-chat', 'openai-gpt4o') */
  model?: string
  /** Router instance (required if model is not a preset) */
  router?: ProviderRouter
  /** System prompt */
  systemPrompt: string
  /** Working directory */
  workingDir?: string
  /** Additional tools */
  tools?: ToolDefinition[]
  /** Permission config override */
  permissions?: Partial<import('@agentnova/contracts').PermissionConfig>
  /** Include built-in fs tools? Default: true */
  includeFsTools?: boolean
  /** Include built-in shell tools? Default: true */
  includeShellTools?: boolean
}

/**
 * Quick-create an agent with sensible defaults.
 * Includes fs + shell built-in tools by default.
 */
export function quickAgent(config: QuickAgentConfig) {
  if (!config.router && !config.model) {
    throw new Error('Either "router" or "model" must be provided')
  }

  const tools: ToolDefinition[] = [
    ...(config.includeFsTools !== false ? fsTools : []),
    ...(config.includeShellTools !== false ? shellTools : []),
    ...(config.tools ?? []),
  ]

  // If model is a preset string, we'd resolve router here
  // For now, require explicit router
  const router = config.router!
  const agentConfig: AgentConfig = {
    systemPrompt: config.systemPrompt,
    workingDir: config.workingDir ?? process.cwd(),
    router,
    tools,
    permissions: config.permissions,
  }

  return createAgent(agentConfig)
}
