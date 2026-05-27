// src/index.ts
import { Agent, createAgent } from "@agentnova/core";
import {
  TraceCollector,
  TraceReplay,
  StructuredLogger
} from "@agentnova/core";
import { ToolRegistry, ToolEngine, defineTool } from "@agentnova/tools";
import { fsTools, shellTools } from "@agentnova/tools";
import { PermissionGuard, DEFAULT_PERMISSION_CONFIG, DEFAULT_LIMITS } from "@agentnova/permission";
import {
  WorkingMemory,
  ProjectMemory,
  MemoryInjector
} from "@agentnova/memory";
import { SkillLoader, SkillRegistry, defineSkill } from "@agentnova/skills";
import { ProviderRouter, createRouter } from "@agentnova/providers";
import {
  createOpenAICompatibleProvider,
  openaiGPT4o,
  deepseekChat,
  qwenMax,
  claudeSonnet4,
  claudeHaiku35
} from "@agentnova/providers";
import { createAgent as createAgent2 } from "@agentnova/core";
import { fsTools as fsTools2, shellTools as shellTools2 } from "@agentnova/tools";
function quickAgent(config) {
  if (!config.router && !config.model) {
    throw new Error('Either "router" or "model" must be provided');
  }
  const tools = [
    ...config.includeFsTools !== false ? fsTools2 : [],
    ...config.includeShellTools !== false ? shellTools2 : [],
    ...config.tools ?? []
  ];
  const router = config.router;
  const agentConfig = {
    systemPrompt: config.systemPrompt,
    workingDir: config.workingDir ?? process.cwd(),
    router,
    tools,
    permissions: config.permissions
  };
  return createAgent2(agentConfig);
}
export {
  Agent,
  DEFAULT_LIMITS,
  DEFAULT_PERMISSION_CONFIG,
  MemoryInjector,
  PermissionGuard,
  ProjectMemory,
  ProviderRouter,
  SkillLoader,
  SkillRegistry,
  StructuredLogger,
  ToolEngine,
  ToolRegistry,
  TraceCollector,
  TraceReplay,
  WorkingMemory,
  claudeHaiku35,
  claudeSonnet4,
  createAgent,
  createOpenAICompatibleProvider,
  createRouter,
  deepseekChat,
  defineSkill,
  defineTool,
  fsTools,
  openaiGPT4o,
  quickAgent,
  qwenMax,
  shellTools
};
//# sourceMappingURL=index.js.map