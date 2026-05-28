# AgentNova SDK — API 参考文档

> 版本：0.1.0 | 更新：2026-05-28

---

## 目录

- [核心模块](#核心模块)
  - [Agent](#agent)
  - [createAgent](#createagent)
- [工具模块](#工具模块)
  - [defineTool](#definetool)
  - [ToolRegistry](#toolregistry)
  - [ToolEngine](#toolengine)
  - [内置工具](#内置工具)
- [权限模块](#权限模块)
  - [PermissionGuard](#permissionguard)
- [Provider 模块](#provider-模块)
  - [ProviderRouter](#providerrouter)
  - [预设 Provider](#预设-provider)
- [记忆模块](#记忆模块)
  - [WorkingMemory](#workingmemory)
  - [ProjectMemory](#projectmemory)
  - [LongTermMemory](#longtermmemory)
  - [MemoryInjector](#memoryinjector)
- [技能模块](#技能模块)
  - [SkillLoader](#skillloader)
  - [SkillRegistry](#skillregistry)
  - [defineSkill](#defineskill)
- [上下文管理](#上下文管理)
  - [ContextManager](#contextmanager)
- [追踪 & 日志](#追踪--日志)
  - [TraceCollector](#tracecollector)
  - [TraceReplay](#tracereplay)
  - [StructuredLogger](#structuredlogger)
- [Usage 追踪](#usage-追踪)
  - [UsageTracker](#usagetracker)
- [生命周期钩子](#生命周期钩子)
- [事件系统](#事件系统)
- [类型定义](#类型定义)

---

## 核心模块

> `import { Agent, createAgent } from 'agentnova'`

### Agent

主 Agent 类，封装 ReAct 循环、工具调用、上下文管理、记忆注入。

#### 构造函数

```typescript
new Agent(config: AgentConfig)
```

**AgentConfig**

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `systemPrompt` | `string` | ✅ | Agent 身份 / 角色 |
| `workingDir` | `string` | ✅ | 工作目录（文件操作基准路径） |
| `router` | `ProviderRouter` | ✅ | 模型路由器 |
| `tools` | `ToolDefinition[]` | ✅ | 注册的工具列表 |
| `permissions` | `Partial<PermissionConfig>` | ❌ | 权限配置覆盖 |
| `context` | `Partial<ContextConfig>` | ❌ | 上下文压缩配置 |
| `longTermMemory` | `LongTermMemoryConfig` | ❌ | 长期记忆配置（SQLite） |
| `skillDirs` | `string[]` | ❌ | 技能目录列表 |

#### 方法

##### `agent.run(prompt, options?)`

非流式执行 Agent。

```typescript
const result: AgentResult = await agent.run('帮我看看有什么文件', {
  maxSteps: 10,               // 最大步数覆盖
  signal: abortController.signal, // 取消信号
  onStep: (step) => { ... },  // 步骤回调
})
```

**AgentResult**

| 属性 | 类型 | 说明 |
|------|------|------|
| `text` | `string` | Agent 最终文本回复 |
| `messages` | `CoreMessage[]` | 完整对话历史 |
| `state` | `AgentState` | Agent 最终状态 |
| `steps` | `StepInfo[]` | 每步执行记录 |
| `totalDurationMs` | `number` | 总耗时 ms |
| `usage` | `UsageSnapshot` | Token 用量和费用 |

##### `agent.runStream(prompt, options?)`

流式执行，通过 `onText` 回调实时输出。

```typescript
const result = await agent.runStream('解释这段代码', {
  onText: (chunk) => process.stdout.write(chunk),
  onStep: (step) => console.log(`Step ${step.step}`),
})
```

##### `agent.registerTool(tool)`

动态注册工具。

##### `agent.hook(name, fn)`

注册生命周期钩子。

```typescript
agent.hook('onBeforeToolCall', async (ctx) => {
  if (ctx.toolCall.tool === 'shell.exec' && /rm/.test(ctx.toolCall.args.cmd)) {
    return { action: 'deny', reason: '不允许删除操作' }
  }
})
```

##### `agent.on(event, handler)`

订阅执行事件（只读，不影响行为）。

##### `agent.remember(key, content, layer?)`

存储记忆。

```typescript
await agent.remember('style', '偏好函数式编程', 'project')
```

##### `agent.getTrace()`

获取执行轨迹。

##### `agent.replayTrace()`

创建轨迹回放实例。

##### `agent.abort()`

中断当前执行。

---

### createAgent

工厂函数，创建 Agent 实例。

```typescript
const agent = createAgent({
  systemPrompt: '你是智能助手',
  workingDir: process.cwd(),
  router: myRouter,
  tools: [...fsTools, ...shellTools],
})
```

---

## 工具模块

> `import { defineTool, ToolRegistry, ToolEngine, fsTools, shellTools } from 'agentnova'`

### defineTool

定义工具的帮助函数。

```typescript
const myTool = defineTool({
  name: 'db.query',
  description: '查询数据库',
  parameters: z.object({
    sql: z.string().describe('SQL 查询语句'),
  }),
  permission: {
    level: 'read',        // 'read' | 'write' | 'dangerous'
    description: '只读查询',
  },
  execute: async ({ sql }, ctx) => {
    ctx.logger.info('Executing query', { sql })
    return await db.query(sql)
  },
})
```

**ToolContext**（`ctx` 参数）

| 属性 | 类型 | 说明 |
|------|------|------|
| `agentState` | `Readonly<AgentStateSnapshot>` | 当前 Agent 状态快照 |
| `workingDir` | `string` | 工作目录 |
| `abortSignal` | `AbortSignal` | 取消信号 |
| `askApproval` | `ApprovalFn` | 请求人工审批 |
| `logger` | `ToolLogger` | 结构化日志 |

---

### ToolRegistry

工具注册中心。

| 方法 | 说明 |
|------|------|
| `register(tool)` | 注册工具（不允许重名） |
| `registerAll(tools)` | 批量注册 |
| `get(name)` | 获取工具定义 |
| `has(name)` | 检查是否存在 |
| `list()` | 列出所有工具名 |
| `getAll()` | 获取所有工具定义 |
| `getToolSchemas()` | 获取 LLM 可消费的 schema |
| `unregister(name)` | 注销工具 |
| `clear()` | 清空所有工具 |

### ToolEngine

工具执行引擎，负责参数校验和执行。

| 方法 | 说明 |
|------|------|
| `execute(call, ctx)` | 执行工具调用（含 Zod 校验） |

---

### 内置工具

```typescript
import { fsTools, shellTools } from 'agentnova'
```

| 工具名 | 权限 | 说明 |
|--------|------|------|
| `fs.readFile` | read | 读取文件内容 |
| `fs.writeFile` | write | 写入文件 |
| `fs.listDir` | read | 列出目录内容 |
| `shell.exec` | dangerous | 执行 Shell 命令 |

---

## 权限模块

> `import { PermissionGuard, DEFAULT_PERMISSION_CONFIG } from 'agentnova'`

### PermissionGuard

三级权限守卫：`auto` / `ask` / `deny`。

```typescript
const guard = new PermissionGuard({
  mode: 'ask',
  rules: [
    { tool: 'fs.readFile', level: 'read' },         // 读操作自动放行
    { tool: 'fs.writeFile', level: 'write' },        // 写操作需确认
    { tool: 'shell.exec', level: 'dangerous' },       // 危险操作
    { tool: 'shell.exec', level: 'dangerous', scope: ['rm *'], mode: 'deny' },  // 黑名单
  ],
  limits: {
    maxSteps: 50,
    timeoutMs: 300000,
    maxTokens: 200000,
    maxToolCalls: 100,
    maxFileSize: 10 * 1024 * 1024,
  },
  onApprovalNeeded: async (req) => {
    const choice = await showApprovalDialog(req)
    return choice  // 'allow-once' | 'allow-always' | 'deny'
  },
  sandbox: {
    enabled: true,
    cwd: '/project',
    allowedDirs: ['/project/src'],
    blockedCommands: ['rm -rf /'],
  },
})
```

| 方法 | 说明 |
|------|------|
| `check(request)` | 检查操作是否允许，返回 `ApprovalResult` |

---

## Provider 模块

> `import { ProviderRouter, createRouter, createOpenAICompatibleProvider } from 'agentnova'`

### ProviderRouter

多 Provider 管理与降级。

```typescript
const router = createRouter(
  [
    { id: 'deepseek', model: deepseekModel, name: 'DeepSeek' },
    { id: 'openai', model: gpt4oModel, name: 'GPT-4o' },
    { id: 'qwen', model: qwenModel, name: 'Qwen Max' },
  ],
  'deepseek',                    // 默认
  ['deepseek', 'qwen', 'openai'], // 降级链
)
```

| 方法 | 说明 |
|------|------|
| `get(id)` | 获取指定 Provider |
| `getDefault()` | 获取默认 Provider |
| `route(complexity?)` | 按复杂度路由 |
| `getFallbackChain()` | 获取降级链 |
| `shouldFallback(error)` | 判断是否应降级 |
| `listProviders()` | 列出所有 Provider ID |

### 预设 Provider

```typescript
import {
  createOpenAICompatibleProvider,
  openaiGPT4o,
  deepseekChat,
  qwenMax,
  claudeSonnet4,
  claudeHaiku35,
} from 'agentnova'
```

| 函数 | 模型 | 说明 |
|------|------|------|
| `openaiGPT4o()` | gpt-4o | OpenAI GPT-4o |
| `deepseekChat()` | deepseek-chat | DeepSeek V3 |
| `qwenMax()` | qwen-max | 通义千问 Max |
| `claudeSonnet4()` | claude-sonnet-4-20250514 | Anthropic Claude Sonnet 4 |
| `claudeHaiku35()` | claude-3-5-haiku-20241022 | Anthropic Claude 3.5 Haiku |

### 自定义 Provider

```typescript
const myProvider = createOpenAICompatibleProvider({
  id: 'my-model',
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.MY_API_KEY,
  modelId: 'my-model-v1',
  name: 'My Custom Model',
})
```

---

## 记忆模块

> `import { WorkingMemory, ProjectMemory, LongTermMemory, MemoryInjector } from 'agentnova'`

### WorkingMemory

内存级短期记忆，随会话结束消失。

```typescript
const mem = new WorkingMemory()
await mem.save('key', 'value')
const item = await mem.get('key')
const results = await mem.search('query', 5)
```

### ProjectMemory

文件级项目记忆，读写 `AGENT.md`。

```typescript
const mem = new ProjectMemory('/project/dir')
await mem.load()           // 从 AGENT.md 加载
await mem.save('偏好', '函数式风格')
```

### LongTermMemory

SQLite + 向量检索的长期记忆。

```typescript
const mem = new LongTermMemory({
  dbPath: './data/memory.db',
  embeddingDim: 384,
  embedFn: async (text) => await embeddingModel(text),
})
await mem.save('bug_fix', 'React useEffect 依赖数组不能漏')
const results = await mem.search('React bug', 5)
```

### MemoryInjector

连通三层记忆，注入 Agent 上下文。

```typescript
const injector = new MemoryInjector(working, project, longTerm)
const context = await injector.inject('用户当前问题', 5)
await injector.store('key', 'content', { layer: 'project' })
```

---

## 技能模块

> `import { SkillLoader, SkillRegistry, defineSkill } from 'agentnova'`

### SkillLoader

从目录加载技能。

```typescript
const loader = new SkillLoader()
const skills = await loader.loadAll(['./skills', './team-skills'])
```

**技能目录结构：**

```
skills/code-review/
├── skill.config.json   # 技能配置
├── SKILL.md            # 技能提示词（LLM 读取）
├── tools/              # 技能专属工具
└── knowledge/          # 技能知识库
```

**skill.config.json 格式：**

```json
{
  "name": "code-review",
  "version": "1.0.0",
  "description": "代码审查技能",
  "prompt": "SKILL.md",
  "tools": ["tools/lint.json", "tools/diff.json"],
  "knowledge": ["knowledge/best-practices.md"],
  "defaultConfig": {}
}
```

### SkillRegistry

技能市场管理（安装/卸载/搜索/发布）。

```typescript
const registry = new SkillRegistry({ skillsDir: './skills' })
await registry.load()

// 搜索
const results = registry.search('code review')

// 安装
await registry.install('https://github.com/team/skills.git')

// 发布
const result = await registry.publish('code-review', {
  remote: 'git@github.com:team/skills.git',
})
// 或发布到 npm
const npmResult = await registry.publish('code-review', {
  registry: 'https://registry.npmjs.org',
})
```

| 方法 | 说明 |
|------|------|
| `load()` | 从磁盘加载注册表 |
| `save()` | 持久化注册表 |
| `search(query)` | 搜索技能 |
| `get(name)` | 获取技能元数据 |
| `list()` | 列出所有技能 |
| `install(source, options?)` | 从 Git/npm 安装 |
| `uninstall(name)` | 卸载技能 |
| `publish(name, options?)` | 发布到 Git 远程或 npm |

---

## 上下文管理

> `import { ContextManager } from '@agentnova/core'`

### ContextManager

自动压缩过长对话，避免超出 Token 窗口。

```typescript
const ctx = new ContextManager({
  preserveRecentTurns: 10,               // 保留最近 10 轮
  compressionTriggerRatio: 0.7,          // 70% 窗口时触发压缩
  compressionStrategy: 'summary',        // 'summary' | 'sliding-window' | 'hybrid'
  maxToolOutputLength: 8000,             // 工具输出最大字符
  toolOutputTruncate: 'tail',            // 'tail' | 'head'
})

if (ctx.needsCompression(messages)) {
  messages = await ctx.compress(messages)
}
```

---

## 追踪 & 日志

> `import { TraceCollector, TraceReplay, StructuredLogger } from 'agentnova'`

### TraceCollector

收集执行过程中的所有事件。

```typescript
const trace = agent.getTrace()
console.log(trace.entries.length)    // 事件记录数
console.log(trace.totalTokens)       // 总 token
console.log(trace.estimatedCost)     // 预估费用
```

### TraceReplay

回放执行轨迹。

```typescript
const replay = agent.replayTrace()
console.log(replay.summary())         // 执行摘要
```

### StructuredLogger

结构化日志记录器。

```typescript
const logger = agent.getLogger()
logger.info('event_name', { key: 'value' })
logger.warn('potential_issue', { detail: '...' })
logger.error('failure', { error: err.message })
console.log(logger.exportNDJSON())    // 导出 NDJSON 格式日志
```

---

## Usage 追踪

> 每次 `agent.run()` 返回的 `result.usage` 包含完整的 token 和费用信息。

```typescript
const snapshot = agent.getUsage()
console.log(snapshot.totalTokens)          // 总 token 数
console.log(snapshot.estimatedCost)        // 预估费用（USD）
console.log(snapshot.inputTokens)          // 输入 token
console.log(snapshot.outputTokens)         // 输出 token
```

支持的定价模型：OpenAI GPT-4o、DeepSeek、Qwen、Claude Sonnet 4 / Haiku 3.5 等。

---

## 生命周期钩子

```typescript
type HookName =
  | 'onStart'          // Agent 启动
  | 'onBeforeLLMCall'  // LLM 调用前（可修改 prompt）
  | 'onAfterLLMCall'   // LLM 响应后
  | 'onBeforeToolCall' // 工具执行前（可拦截/修改参数）
  | 'onAfterToolCall'  // 工具执行后（可修改结果）
  | 'onEnd'            // Agent 结束
  | 'onError'          // 出错
```

**Hook 返回值**：
- 无返回 / `void` → 继续执行
- `{ action: 'deny', reason: string }` → 拦截操作

---

## 事件系统

```typescript
type AgentEventName =
  | 'agent:start' | 'agent:end' | 'agent:error'
  | 'llm:call' | 'llm:response'
  | 'tool:call' | 'tool:result' | 'tool:approved' | 'tool:denied'
  | 'context:compressed'
  | 'memory:stored' | 'memory:retrieved'
  | 'skill:activated' | 'skill:deactivated'
  | 'provider:fallback'
  | 'step'
```

事件订阅不会影响 Agent 行为（与 Hook 互补）。

---

## 类型定义

完整类型导出：

```typescript
// Core
export type { AgentConfig, AgentState, AgentRunOptions, AgentResult, StepInfo }

// Tools  
export type { ToolDefinition, ToolCall, ToolResult, ToolContext, ToolPermission }

// Permission
export type { PermissionConfig, PermissionRule, SandboxConfig, ResourceLimits }

// Memory
export type { MemoryItem, MemoryStore, LongTermMemoryConfig }

// Skills
export type { SkillConfig, Skill, SkillManifest }

// Providers
export type { ProviderConfig, RoutingConfig, TaskComplexity, ProviderId }
```
