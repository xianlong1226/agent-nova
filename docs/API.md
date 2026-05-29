# AgentNova SDK — API 参考文档

> 版本与变更以各包 `package.json` 与 [CHANGELOG](../.changeset) 为准。

---

## 目录

- [核心模块](#核心模块)
  - [Agent](#agent)
  - [createAgent](#createagent)
  - [quickAgent](#quickagent)
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
  - [RateLimiter](#ratelimiter)
- [记忆模块](#记忆模块)
  - [WorkingMemory](#workingmemory)
  - [ProjectMemory](#projectmemory)
  - [LongTermMemory](#longtermmemory)
  - [MemoryInjector](#memoryinjector)
- [技能模块](#技能模块)
  - [SkillLoader](#skillloader)
  - [SkillRegistry](#skillregistry)
  - [SkillLoaderWorker](#skillloaderworker)
  - [defineSkill](#defineskill)
- [会话模块](#会话模块)
  - [SessionManager](#sessionmanager)
- [上下文管理](#上下文管理)
  - [ContextManager](#contextmanager)
- [错误模块](#错误模块)
  - [AgentError](#agenterror)
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

### quickAgent

带合理默认值的快速工厂函数：默认叠加 `fsTools` + `shellTools`。

```typescript
import { quickAgent, createRouter, createOpenAICompatibleProvider } from 'agentnova'

const provider = createOpenAICompatibleProvider({
  id: 'deepseek',
  name: 'DeepSeek',
  model: 'deepseek-chat',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY!,
})

const agent = quickAgent({
  systemPrompt: '你是个文件助手。',
  router: createRouter([provider], provider.id),
  // 可选：调整默认工具或追加自定义工具
  // includeFsTools: false,
  // includeShellTools: false,
  // tools: [myTool],
  // permissions: { mode: 'ask' },
})
```

**QuickAgentConfig**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `systemPrompt` | `string` | ✅ | 系统提示词 |
| `router` | `ProviderRouter` | ⚠️ | 与 `model` 二选一（当前仅 `router` 生效，`model` 预留） |
| `model` | `string` | ⚠️ | 预设模型名，与 `router` 二选一 |
| `workingDir` | `string` | ❌ | 默认 `process.cwd()` |
| `tools` | `ToolDefinition[]` | ❌ | 额外工具 |
| `includeFsTools` | `boolean` | ❌ | 默认 `true` |
| `includeShellTools` | `boolean` | ❌ | 默认 `true` |
| `permissions` | `Partial<PermissionConfig>` | ❌ | 权限覆写 |

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
| `fs.readFile` | read | 读取文件内容（内置 preflight：路径白名单 + 文件大小限制） |
| `fs.writeFile` | write | 写入文件（内置 preflight） |
| `fs.listDir` | read | 列出目录内容 |
| `fs.stat` | read | 获取文件/目录元信息（大小、修改时间、类型） |
| `shell.exec` | dangerous | 执行 Shell 命令（内置 preflight：命令黑名单） |

---

## 权限模块

> `import { PermissionGuard, DEFAULT_PERMISSION_CONFIG } from 'agentnova'`
>
> 共享类型（`PermissionConfig` / `PermissionLevel` / `ApprovalRequest` / `ToolPermission` / `SandboxConfig` / `ResourceLimits` / `ToolPreflight` 等）位于 [@agentnova/contracts](https://www.npmjs.com/package/@agentnova/contracts)，通过顶层 `agentnova` 入口转发。

### PermissionGuard

负责 mode/rules 决策与审批回调调度；sandbox 作为配置容器传递给各工具的 `preflight` 钩子。

```typescript
const guard = new PermissionGuard({
  mode: 'ask',
  rules: [
    // 空数组意味着完全由 LEVEL_DEFAULT_MODE 兜底（read=allow / write=ask / dangerous=ask）
    { tool: 'fs.writeFile', mode: 'allow' },     // 覆写：写文件不再弹审批
    { tool: 'shell.*',      mode: 'deny' },       // 通配：全部 shell 工具拒绝
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
    blockedCommandPatterns: [
      'rm\\s+-[rR].*\\s+/',
      'curl\\s+.*\\|\\s*sh',
    ],
    maxFileSize: 10 * 1024 * 1024,
  },
})
```

| 方法 | 说明 |
|------|------|
| `check(request, preflight?)` | 决策入口；可选 `preflight` 为工具自带的沙箱钩子，返回 `'deny'` 可提前拦截；之后走 alwaysAllowed → rules → mode → LEVEL_DEFAULT_MODE 决策链 |
| `getEffectiveMode(req)` | 返回工具最终生效的 mode（不含 preflight） |
| `resetAllowAlways(tool?)` | 清空 always-allowed 缓存 |
| `getSandbox()` | 返回当前沙箱配置 |
| `static matchToolPattern(pattern, name)` | 工具名通配辅助（支持 `*` / `ns.*`） |

### preflight 钩子

沙箱前置校验随工具走，在 `defineTool` 时设置 `preflight` 字段即可：

```typescript
import { defineTool, type ToolPreflight } from 'agentnova'

const myPreflight: ToolPreflight = (req, ctx) => {
  if (!ctx.sandbox.enabled) return { ok: true }
  if (req.args?.target === 'forbidden') {
    return { ok: false, reason: 'target not allowed' }
  }
  return { ok: true }
}

export const myTool = defineTool({
  name: 'demo.action',
  description: '...',
  parameters: z.object({ target: z.string() }),
  permission: { level: 'write' },
  preflight: myPreflight,
  execute: async (input, ctx) => { /* ... */ },
})
```

内置 `fs.*` / `shell.exec` 工具已内置对应 preflight（路径白名单、文件大小、命令黑名单），无需额外配置。

### 注册期 Lint

`Agent` 构造期会静默调用 `lintPermissions()`，对以下情况输出 `logger.warn`（不抛错）：

- `rules` 引用了未注册的工具名（通配符除外）
- `dangerous` 级别工具被某条 rule 设为 `allow`
- `read` 级别工具被某条 rule 设为 `deny`

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

### RateLimiter

Provider 级别的令牌桶限流 + 429 退避器；默认供底层路由使用，也可独立包裹需要限速的调用。

```typescript
import { RateLimiter } from 'agentnova'

const limiter = new RateLimiter({
  callsPerMinute: 60,
  tokensPerMinute: 100_000,
  perProvider: {
    deepseek: { callsPerMinute: 30 },
  },
  backoffMultiplier: 2,
  maxBackoffMs: 60_000,
})

// 在调用前获取许可（突破限额会自动 await）
await limiter.acquire('deepseek', 1500)

// 遇到 429 后上报
limiter.reportRateLimited('deepseek', 5000)

// 调用成功后释放退避
limiter.reportSuccess('deepseek')
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `callsPerMinute` | `60` | 全局调用限额 |
| `tokensPerMinute` | `100_000` | 全局 token 限额 |
| `perProvider` | `{}` | 按 `providerId` 覆写限额 |
| `backoffMultiplier` | `2` | 429 退避倍率 |
| `maxBackoffMs` | `60_000` | 退避间隔上限 |

| 方法 | 说明 |
|------|------|
| `acquire(providerId, estimatedTokens)` | 获取调用许可，超限自动 await |
| `reportRateLimited(providerId, retryAfterMs?)` | 上报 429，击发退避 |
| `reportSuccess(providerId)` | 调用成功后清除退避 |

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

### SkillLoaderWorker

运行时按用户输入动态激活技能，仅暴露当前对话需要的工具与系统提示，避免污染主上下文。

```typescript
import { SkillLoaderWorker } from '@agentnova/core'

const worker = new SkillLoaderWorker()
await worker.loadAll(['./skills', './team-skills'])

// 根据用户输入激活相关技能
await worker.activateForInput('帮我审查这段 PR')

// 获取当前激活的工具与提示
const tools = worker.getActiveTools()
const prompts = worker.getActivePrompts()

const agent = createAgent({
  router,
  tools,
  systemPrompt: prompts.join('\n\n'),
})
```

| 方法 | 说明 |
|------|------|
| `loadAll(dirs)` | 从指定目录批量加载技能定义 |
| `activateForInput(input)` | 根据输入文本匹配并激活技能（基于关键词/触发条件） |
| `getActiveTools()` | 返回当前激活技能贡献的工具集 |
| `getActivePrompts()` | 返回当前激活技能贡献的系统提示数组 |

---

## 会话模块

> `import { SessionManager } from '@agentnova/core'`

### SessionManager

多用户多会话管理器，提供持久化、自动保存与同用户串行锁，避免同一用户的并发会话互相覆盖。

```typescript
import { SessionManager } from '@agentnova/core'

const sm = new SessionManager({
  storageDir: './sessions',        // 持久化目录（默认 './sessions'）
  persist: true,                   // 是否落盘（默认 true）
  autoSaveIntervalMs: 30_000,      // 自动保存间隔（默认 30s）
  maxConcurrentPerUser: 1,         // 同用户最大并发（默认 1，串行锁）
})

// 启动时加载已有会话
await sm.loadAllSessions()

// 创建会话
const session = sm.createSession('user-123', { title: '产品讨论' })

// 串行运行：同一 userId 的多次 withSession 会自动排队
const result = await sm.withSession(session.id, async (data) => {
  // data: SessionData，包含 messages / state / metadata
  return await agent.run('继续刚才的话题', { state: data.state })
})

// 优雅退出：保存所有会话并停止定时器
await sm.shutdown()
```

| 方法 | 说明 |
|------|------|
| `createSession(userId, meta?)` | 创建会话，返回 `SessionData` |
| `getSession(sessionId)` | 获取会话数据 |
| `getUserSessions(userId)` | 获取某用户全部会话 |
| `getLatestSession(userId)` | 获取某用户最近一次会话 |
| `withSession(sessionId, fn)` | 在串行锁内运行任务，结束后自动保存 |
| `saveSession(sessionId)` | 立即持久化指定会话 |
| `saveAll()` | 持久化全部会话 |
| `loadSession(sessionId)` | 从磁盘加载单个会话 |
| `loadAllSessions()` | 启动时批量加载 |
| `deleteSession(sessionId)` | 删除会话（含磁盘文件） |
| `shutdown()` | 停止自动保存定时器并保存所有会话 |

**默认配置**（`DEFAULT_SESSION_CONFIG`）：

```typescript
{
  storageDir: './sessions',
  persist: true,
  autoSaveIntervalMs: 30_000,
  maxConcurrentPerUser: 1,
}
```

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

## 错误模块

> `import { AgentError, isRetryable, getRetryDelay, wrapProviderError, toolError } from 'agentnova'`

### AgentError

统一错误类型，承载错误码、是否可重试、建议退避时间等结构化信息。

```typescript
import { AgentError, isRetryable, getRetryDelay, wrapProviderError, toolError } from 'agentnova'

try {
  await agent.run('...')
} catch (err) {
  if (err instanceof AgentError) {
    console.log(err.code)        // ErrorCode，如 'PROVIDER_RATE_LIMITED'
    console.log(err.category)    // RetryCategory: 'retryable' | 'fatal' | 'permission'
    console.log(err.retryable)   // boolean
    console.log(err.retryAfterMs) // 建议等待毫秒（若有）
  }

  if (isRetryable(err)) {
    const delay = getRetryDelay(err, /* attempt */ 2) // 指数退避计算
    await new Promise(r => setTimeout(r, delay))
    // 重试...
  }
}
```

**错误码（`ErrorCode`）：**

| Code | 含义 | 类别 |
|------|------|------|
| `PROVIDER_RATE_LIMITED` | Provider 限流（429） | retryable |
| `PROVIDER_TIMEOUT` | 请求超时 | retryable |
| `PROVIDER_UNAVAILABLE` | 服务不可用（5xx） | retryable |
| `PROVIDER_AUTH` | 认证失败（401/403） | fatal |
| `PROVIDER_BAD_REQUEST` | 参数错误（400） | fatal |
| `TOOL_EXECUTION_FAILED` | 工具执行抛错 | retryable |
| `TOOL_TIMEOUT` | 工具超时 | retryable |
| `PERMISSION_DENIED` | 用户/规则拒绝 | permission |
| `RESOURCE_LIMIT_EXCEEDED` | 触达资源上限 | fatal |
| `CONTEXT_OVERFLOW` | 上下文超窗 | fatal |

**辅助函数：**

| 函数 | 说明 |
|------|------|
| `isRetryable(err)` | 判断错误是否可重试（仅 `category === 'retryable'`） |
| `getRetryDelay(err, attempt)` | 计算建议退避毫秒（优先使用 `retryAfterMs`，否则指数退避） |
| `wrapProviderError(err, providerId)` | 将 Provider 原始错误（OpenAI / Anthropic 等）规范为 `AgentError` |
| `toolError(code, message, opts?)` | 工具内构造 `AgentError` 的便捷函数 |

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
export type {
  AgentConfig, AgentState, AgentRunOptions, AgentResult, StepInfo,
  ContextConfig, CompressionStrategy,
  Trace, TraceEntry, LogEntry, LogLevel, UsageSnapshot,
  SessionData, SessionConfig,
  HookName, HookFn, HookContext,
  AgentEvent, AgentEventName, EventHandler,
  ErrorCode, RetryCategory,
}

// Tools
export type {
  ToolDefinition, ToolCall, ToolResult, ToolContext, ToolPermission,
  ToolPreflight, ToolPreflightCtx, PreflightResult,
}

// Permission
export type {
  PermissionConfig, PermissionRule, PermissionMode,
  SandboxConfig, ResourceLimits,
  ApprovalRequest, ApprovalResult,
}

// Memory
export type { MemoryItem, MemoryStore, LongTermMemoryConfig }

// Skills
export type { SkillConfig, Skill, SkillManifest }

// Providers
export type {
  ProviderConfig, RoutingConfig, TaskComplexity, ProviderId,
  RateLimiterConfig,
}
```

> 上述类型可直接从顶层包 `'agentnova'` 引用；若需绑定到具体子包（如 `'@agentnova/core'`），请参考各包源码导出。
