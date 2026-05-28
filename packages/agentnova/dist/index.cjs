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
  Agent: () => import_core.Agent,
  DEFAULT_LIMITS: () => import_permission.DEFAULT_LIMITS,
  DEFAULT_PERMISSION_CONFIG: () => import_permission.DEFAULT_PERMISSION_CONFIG,
  MemoryInjector: () => import_memory.MemoryInjector,
  PermissionGuard: () => import_permission.PermissionGuard,
  ProjectMemory: () => import_memory.ProjectMemory,
  ProviderRouter: () => import_providers.ProviderRouter,
  SkillLoader: () => import_skills.SkillLoader,
  SkillRegistry: () => import_skills.SkillRegistry,
  StructuredLogger: () => import_core2.StructuredLogger,
  ToolEngine: () => import_tools.ToolEngine,
  ToolRegistry: () => import_tools.ToolRegistry,
  TraceCollector: () => import_core2.TraceCollector,
  TraceReplay: () => import_core2.TraceReplay,
  WorkingMemory: () => import_memory.WorkingMemory,
  claudeHaiku35: () => import_providers2.claudeHaiku35,
  claudeSonnet4: () => import_providers2.claudeSonnet4,
  createAgent: () => import_core.createAgent,
  createOpenAICompatibleProvider: () => import_providers2.createOpenAICompatibleProvider,
  createRouter: () => import_providers.createRouter,
  deepseekChat: () => import_providers2.deepseekChat,
  defineSkill: () => import_skills.defineSkill,
  defineTool: () => import_tools.defineTool,
  fsTools: () => import_tools2.fsTools,
  openaiGPT4o: () => import_providers2.openaiGPT4o,
  quickAgent: () => quickAgent,
  qwenMax: () => import_providers2.qwenMax,
  shellTools: () => import_tools2.shellTools
});
module.exports = __toCommonJS(index_exports);
var import_core = require("@agentnova/core");
var import_core2 = require("@agentnova/core");
var import_tools = require("@agentnova/tools");
var import_tools2 = require("@agentnova/tools");
var import_permission = require("@agentnova/permission");
var import_memory = require("@agentnova/memory");
var import_skills = require("@agentnova/skills");
var import_providers = require("@agentnova/providers");
var import_providers2 = require("@agentnova/providers");
var import_core3 = require("@agentnova/core");
var import_tools3 = require("@agentnova/tools");
function quickAgent(config) {
  if (!config.router && !config.model) {
    throw new Error('Either "router" or "model" must be provided');
  }
  const tools = [
    ...config.includeFsTools !== false ? import_tools3.fsTools : [],
    ...config.includeShellTools !== false ? import_tools3.shellTools : [],
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
  return (0, import_core3.createAgent)(agentConfig);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
});
//# sourceMappingURL=index.cjs.map