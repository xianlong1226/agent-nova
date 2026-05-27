# AgentNova SDK — 项目方案

> 借鉴 Claude Code 核心设计，基于 Vercel AI SDK 构建的通用 Agent 开发框架

---

## 一、项目概述

**定位**：可嵌入的 TypeScript Library，让团队快速构建通用任务 Agent

**核心理念**：
- 🔧 **Tool-First** — 工具是 Agent 的手脚，一切能力通过工具暴露
- 🛡️ **Safe-by-Default** — 危险操作默认拦截，显式授权才放行
- 🧠 **Context-Aware** — 智能上下文管理，不浪费一个 token
- 🧩 **Skill-Driven** — 能力模块化，按需加载，即插即用

---

## 二、架构设计

```
┌──────────────────────────────────────────────────────┐
│                   AgentNova SDK                       │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Agent Loop  │  │  Context    │  │   Memory    │  │
│  │  (ReAct)    │  │  Manager    │  │   System    │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│         │                │                │          │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  │
│  │ Tool Engine │  │  Skill      │  │   Event     │  │
│  │             │  │  Loader     │  │   Bus       │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────┘  │
│         │                │                           │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌─────────────┐  │
│  │ Permission  │  │  Provider   │  │   Lifecycle  │  │
│  │ Guard       │  │  Router     │  │   Hooks      │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                      │
├──────────────────────────────────────────────────────┤
│              Vercel AI SDK (底层依赖)                  │
│     generateText / streamText / tool calling / ...    │
└──────────────────────────────────────────────────────┘
```

### 核心模块职责

| 模块 | 职责 | Claude Code 对标 |
|------|------|-----------------|
| **Agent Loop** | ReAct 循环：思考→工具→观察→再思考 | 主循环，支持中断/取消 |
| **Tool Engine** | 工具注册、校验、执行、结果回传 | Bash/Read/Edit/Write 等工具系统 |
| **Permission Guard** | 权限分级、审批回调、沙箱限制 | allow/deny 规则 + 审批模式 |
| **Context Manager** | 对话压缩、窗口策略、关键信息保留 | 上下文裁剪 + 摘要压缩 |
| **Memory System** | 短期记忆 + 长期记忆 + 语义检索 | CLAUDE.md + 跨会话持久化 |
| **Skill Loader** | 技能包加载、隔离、生命周期 | Skills 目录 + SKILL.md |
| **Provider Router** | 多 provider 适配、降级、模型路由 | 模型切换能力 |
| **Event Bus** | 执行过程事件发布，可订阅 | hooks 系统 |
| **Lifecycle Hooks** | 可插拔的 Agent 生命周期钩子 | PreToolCall / PostToolCall 等 |

---

## 三、核心模块详细设计

### 3.1 Agent Loop（核心循环）

```
用户输入
  ↓
构建 Prompt (system + context + memory + skills)
  ↓
调用 LLM (via Provider Router)
  ↓
┌─→ 解析响应
│   ├─ 纯文本 → 返回结果
│   └─ 工具调用 → Permission Guard 审批
│       ├─ 拒绝 → 告知 LLM 被拒绝原因，继续循环
│       └─ 通过 → 执行工具 → 观察结果 → 附加到上下文 → 回到 ↑
│
│ 超过 maxSteps / token / timeout → 终止循环
└─────────────────────────────────────────────
```

**关键设计**：
- 基于 Vercel AI SDK 的 `maxSteps` 实现多步循环
- 支持 `AbortController` 中断
- 每步都发射事件到 Event Bus
- 循环内部维护 `AgentState` 状态机

```typescript
// 使用示例
const agent = createAgent({
  model: 'gpt-4o',
  tools: [readFile, writeFile, bash],
  skills: ['code-review', 'git-ops'],
  permissions: { mode: 'ask' }, // 默认需审批
})

const result = await agent.run('帮我重构 src/utils.ts', {
  onStep: (step) => console.log(step),
  signal: abortController.signal,
})
```

### 3.2 Tool Engine（工具引擎）

**工具定义规范**（借鉴 Claude Code + Vercel AI SDK）：

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string                    // 工具名，如 'fs.readFile'
  description: string             // LLM 看到的描述
  parameters: ZodSchema<TInput>   // Zod schema 校验
  
  // 权限声明（核心！）
  permission: {
    level: 'read' | 'write' | 'dangerous'  // 权限等级
    scope?: string[]                         // 作用域限制，如路径白名单
    description?: string                     // 给人看的权限说明
  }
  
  // 执行逻辑
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>
}

// ToolContext 提供：
interface ToolContext {
  agentState: AgentState        // 当前 Agent 状态
  workingDir: string            // 工作目录
  abortSignal: AbortSignal      // 取消信号
  askApproval: ApprovalFn       // 请求人工审批
  logger: ToolLogger            // 结构化日志
}
```

**内置工具集**（MVP 阶段）：

| 工具 | 权限 | 说明 |
|------|------|------|
| `fs.readFile` | read | 读取文件 |
| `fs.writeFile` | write | 写入文件 |
| `fs.listDir` | read | 列目录 |
| `shell.exec` | dangerous | 执行命令 |
| `web.fetch` | read | 请求 URL |
| `web.search` | read | 搜索 |

**自定义工具扩展**：

```typescript
const myTool = defineTool({
  name: 'db.query',
  description: '查询数据库',
  parameters: z.object({ sql: z.string() }),
  permission: { level: 'read', scope: ['SELECT'] },
  execute: async ({ sql }, ctx) => {
    // 自定义逻辑
    return result
  },
})

agent.registerTool(myTool)
```

### 3.3 Permission Guard（权限守卫）

**三级权限模型**（借鉴 Claude Code）：

```
┌─────────────────────────────────────────┐
│           Permission Mode               │
├───────────┬───────────┬─────────────────┤
│   allow   │   ask     │    deny         │
│ 自动放行  │ 需审批    │   直接拒绝      │
└───────────┴───────────┴─────────────────┘

工具权限等级：
  read       → 默认 allow
  write      → 默认 ask
  dangerous  → 默认 deny (必须显式 allow)
```

**权限配置**：

```typescript
const agent = createAgent({
  permissions: {
    mode: 'ask',                       // 全局默认模式
    rules: [
      // 细粒度规则
      { tool: 'fs.readFile', mode: 'allow' },
      { tool: 'fs.writeFile', mode: 'allow', scope: '/project/**' },
      { tool: 'shell.exec', mode: 'ask' },
      { tool: 'shell.exec', mode: 'deny', scope: 'rm -rf *' },
    ],
    // 审批回调（宿主应用实现 UI）
    onApprovalNeeded: async (request) => {
      // request: { tool, args, permission, reason }
      const approved = await showApprovalDialog(request)
      return approved ? 'allow-once' : 'deny'
    },
    // 沙箱限制
    sandbox: {
      cwd: '/project',                 // 限制工作目录
      allowedDirs: ['/project'],       // 可访问目录
      blockedCommands: ['rm -rf /'],   // 黑名单命令
      maxFileSize: 10 * 1024 * 1024,   // 文件大小限制
    },
  },
})
```

**审批结果类型**：
- `allow-once` — 本次放行，下次还要问
- `allow-always` — 以后同类操作自动放行
- `deny` — 拒绝本次

**资源限制**：

```typescript
limits: {
  maxSteps: 50,           // 最大循环步数
  maxTokens: 200000,      // 最大 token 消耗
  maxToolCalls: 100,      // 最大工具调用次数
  timeoutMs: 300000,      // 超时时间
  maxFileSize: 10 * 1024 * 1024,
}
```

### 3.4 Context Manager（上下文管理）

**核心问题**：LLM 上下文窗口有限，长任务必须裁剪

**策略组合**（借鉴 Claude Code 的上下文裁剪）：

```
Context Window (e.g. 128K tokens)
┌──────────────────────────────────────────────────┐
│ System Prompt (固定，不裁剪)                       │
│ ├─ Agent 身份描述                                  │
│ ├─ 加载的 Skill 描述                               │
│ └─ 工具列表                                        │
├──────────────────────────────────────────────────┤
│ Memory Block (高优先级，尽量保留)                   │
│ ├─ 长期记忆摘要                                    │
│ ├─ 相关记忆片段 (语义检索)                          │
│ └─ 用户偏好                                        │
├──────────────────────────────────────────────────┤
│ Conversation History (可裁剪)                      │
│ ├─ 最近 N 轮完整保留                               │
│ ├─ 更早的轮次 → 摘要压缩                           │
│ └─ 工具调用结果 → 保留关键信息，裁剪冗余输出         │
├──────────────────────────────────────────────────┤
│ Current Task Context (动态)                        │
│ ├─ 当前用户输入                                    │
│ └─ 工作目录状态摘要                                │
└──────────────────────────────────────────────────┘
```

**压缩策略**：

```typescript
interface ContextConfig {
  // 最近 N 轮完整保留
  preserveRecentTurns: number           // 默认 10
  
  // 压缩触发条件
  compressionTrigger: {
    tokenThreshold: number              // 达到 token 阈值触发，默认 contextWindow * 0.7
  }
  
  // 压缩方式
  compressionStrategy: 'summary' | 'sliding-window' | 'hybrid'
  
  // 工具输出裁剪
  toolOutputLimits: {
    maxOutputLength: number             // 默认 8000 字符
    truncateStrategy: 'tail' | 'head' | 'summary'
  }
  
  // 按 provider 动态适配
  contextWindowSize: Record<ProviderId, number>  // 如 { openai: 128000, anthropic: 200000 }
}
```

**压缩实现**：

```typescript
class ContextManager {
  // 当 token 超阈值时触发
  async compress(messages: Message[]): Promise<Message[]> {
    const [recent, older] = splitAt(messages, this.config.preserveRecentTurns)
    
    // 方案1：摘要压缩（用 LLM 生成摘要）
    const summary = await this.summarize(older)
    
    // 方案2：滑动窗口（直接丢弃）
    // 直接截断
    
    // 方案3：混合（摘要 + 关键信息提取）
    // 关键信息 = 工具调用结果 + 用户关键指令
    
    return [summaryMessage, ...recent]
  }
}
```

### 3.5 Memory System（记忆系统）

**三层记忆架构**（借鉴 Claude Code 的 CLAUDE.md 系统）：

```
┌─────────────────────────────────────────────┐
│  Layer 1: Working Memory (短期)              │
│  当前会话的对话历史，随会话结束而消失          │
│  存储：内存                                   │
├─────────────────────────────────────────────┤
│  Layer 2: Project Memory (项目级)            │
│  类似 CLAUDE.md，项目目录下的持久化配置        │
│  存储：文件系统 (~/.agentnova/memory/)        │
│  内容：项目偏好、约定、常用模式                │
├─────────────────────────────────────────────┤
│  Layer 3: Long-term Memory (长期)            │
│  跨项目持久化，语义检索                        │
│  存储：本地向量库 (SQLite + embeddings)        │
│  内容：用户偏好、学到的知识、常用工作流         │
└─────────────────────────────────────────────┘
```

**Memory 文件格式**（借鉴 CLAUDE.md）：

```markdown
# AGENT.md — 项目级记忆

## 用户偏好
- 用中文回复
- 代码风格：函数式优先

## 项目约定
- 使用 pnpm
- 测试框架 vitest
- 提交格式 conventional commits

## 常见模式
- 重构时先写测试
- 部署前跑 lint + typecheck
```

**语义检索**：

```typescript
interface MemoryStore {
  // 存储
  save(key: string, content: string, metadata?: Record<string, string>): Promise<void>
  
  // 精确读取
  get(key: string): Promise<string | null>
  
  // 语义搜索
  search(query: string, topK?: number): Promise<MemoryItem[]>
  
  // 删除
  delete(key: string): Promise<void>
}

// 注入到 Agent 上下文
class MemoryInjector {
  async inject(agentContext: AgentContext): Promise<string> {
    // 1. 读取 AGENT.md（项目记忆）
    const projectMemory = await this.readAgentMd()
    
    // 2. 语义搜索相关记忆
    const relevant = await this.memoryStore.search(agentContext.currentInput, 5)
    
    // 3. 拼装成上下文
    return formatMemoryContext(projectMemory, relevant)
  }
}
```

### 3.6 Skill System（技能系统）

**Skill = 工具 + 提示词 + 知识 + 配置**，借鉴 Claude Code 的 Skills 目录体系。

**Skill 目录结构**：

```
skills/
├── code-review/
│   ├── SKILL.md           # 技能描述（LLM 读取）
│   ├── skill.config.ts    # 技能配置
│   ├── tools/             # 技能专属工具
│   │   ├── lint.ts
│   │   └── diff.ts
│   └── knowledge/         # 技能知识库
│       └── best-practices.md
├── git-ops/
│   ├── SKILL.md
│   ├── skill.config.ts
│   └── tools/
│       ├── commit.ts
│       └── pr.ts
└── data-analysis/
    ├── SKILL.md
    ├── skill.config.ts
    └── tools/
        ├── csv-read.ts
        └── chart.ts
```

**SKILL.md 格式**：

```markdown
# Code Review Skill

## 能力
审查代码质量，发现 bug、安全漏洞、性能问题

## 何时使用
- 用户要求 review 代码
- 提交 PR 前
- 代码重构后

## 工作流程
1. 读取变更文件
2. 分析 diff
3. 按维度评估（正确性/安全性/性能/可维护性）
4. 输出结构化审查报告

## 输出格式
...
```

**skill.config.ts 格式**：

```typescript
import { defineSkill } from 'agentnova'

export default defineSkill({
  name: 'code-review',
  version: '1.0.0',
  description: '代码审查技能',
  
  // 技能依赖的工具
  tools: ['./tools/lint.ts', './tools/diff.ts'],
  
  // 技能提供的提示词片段
  prompt: './SKILL.md',
  
  // 技能知识（注入上下文）
  knowledge: ['./knowledge/**/*.md'],
  
  // 技能激活条件
  activateOn: (input: string) => {
    return /review|审查|代码质量/.test(input)
  },
  
  // 技能配置 Schema
  configSchema: z.object({
    strictness: z.enum(['loose', 'normal', 'strict']).default('normal'),
    lintRules: z.array(z.string()).optional(),
  }),
})
```

**Skill 加载 & 隔离**：

```typescript
class SkillLoader {
  private loadedSkills: Map<string, Skill> = new Map()
  
  // 从目录加载
  async loadFromDir(dir: string): Promise<Skill>
  
  // 从 npm 包加载
  async loadFromPackage(pkg: string): Promise<Skill>
  
  // 按需激活（懒加载）
  async activateIfNeeded(input: string): Promise<Skill[]>
  
  // 获取激活技能的工具列表
  getActiveTools(): ToolDefinition[]
  
  // 获取激活技能的提示词片段
  getActivePrompts(): string[]
  
  // 获取激活技能的知识
  getActiveKnowledge(): string[]
}

// Skill 隔离机制：
// 1. 每个技能的工具在独立作用域内执行
// 2. 技能间不共享状态（除非通过 AgentState）
// 3. 技能的工具只在该技能激活时对 LLM 可见
```

**Skill 市场机制**：

```typescript
// 团队共享：通过 Git 仓库或 npm 包
interface SkillRegistry {
  // 注册技能
  publish(skill: SkillManifest): Promise<void>
  
  // 搜索技能
  search(query: string): Promise<SkillManifest[]>
  
  // 安装技能
  install(name: string): Promise<Skill>
}

// 技能清单格式 (skill-manifest.json)
{
  "name": "code-review",
  "version": "1.0.0",
  "description": "代码审查技能",
  "author": "team-xxx",
  "source": "git@github.com:team/skills.git#code-review/v1.0.0",
  "dependencies": {
    "agentnova": "^0.1.0"
  }
}
```

### 3.7 Provider Router（多 Provider 路由）

**基于 Vercel AI SDK 的 Provider 体系**：

```typescript
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai' // 兼容国产模型

// Provider 配置
const providers = {
  openai: openai('gpt-4o'),
  anthropic: anthropic('claude-sonnet-4-20250514'),
  deepseek: createOpenAI({ 
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY 
  })('deepseek-chat'),
  qwen: createOpenAI({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.QWEN_API_KEY
  })('qwen-max'),
}

// 路由策略
interface RouterConfig {
  // 默认 provider
  default: string
  
  // 模型路由：按任务复杂度选模型
  routing?: {
    simple: string    // 简单任务 → 便宜模型
    complex: string   // 复杂任务 → 强模型
    coding: string    // 编码任务 → 代码模型
  }
  
  // 降级链
  fallbackChain: string[]  // 如 ['deepseek', 'qwen', 'openai']
  
  // 降级触发条件
  fallbackOn?: {
    errorCodePatterns: string[]  // 如 ['rate_limit', '429']
    timeoutMs: number
  }
}

// 实现
class ProviderRouter {
  async route(task: AgentTask): Promise<ModelProvider> {
    // 1. 检查路由规则
    if (this.config.routing) {
      const complexity = this.assessComplexity(task)
      const providerId = this.config.routing[complexity]
      return this.getProvider(providerId)
    }
    
    // 2. 默认
    return this.getProvider(this.config.default)
  }
  
  async callWithFallback(task: AgentTask): Promise<LLMResponse> {
    const chain = [await this.route(task), ...this.config.fallbackChain.map(id => this.getProvider(id))]
    
    for (const provider of chain) {
      try {
        return await provider.generate(task)
      } catch (e) {
        if (this.shouldFallback(e)) continue
        throw e
      }
    }
    throw new Error('All providers failed')
  }
}
```

### 3.8 Event Bus & Lifecycle Hooks

**生命周期钩子**（借鉴 Claude Code hooks 系统）：

```typescript
type HookName = 
  | 'onStart'          // Agent 启动
  | 'onBeforeLLMCall'  // 调用 LLM 前（可修改 prompt）
  | 'onAfterLLMCall'   // LLM 响应后
  | 'onBeforeToolCall' // 工具执行前（可拦截/修改参数）
  | 'onAfterToolCall'  // 工具执行后（可修改结果）
  | 'onApprovalNeeded' // 需要审批时
  | 'onStep'           // 每步完成
  | 'onEnd'            // Agent 结束
  | 'onError'          // 出错

interface HookContext {
  agentState: AgentState
  step: number
  toolCall?: ToolCall
  result?: ToolResult
  // 钩子可以修改这些字段来影响 Agent 行为
}

// 注册钩子
agent.hook('onBeforeToolCall', async (ctx) => {
  // 记录审批日志
  await auditLog(ctx.toolCall)
  
  // 可以拦截工具调用
  if (ctx.toolCall.name === 'shell.exec' && ctx.toolCall.args.command.includes('rm')) {
    return { action: 'deny', reason: '不允许删除操作' }
  }
})

agent.hook('onAfterToolCall', async (ctx) => {
  // 修改工具结果
  if (ctx.result.output.length > 10000) {
    ctx.result.output = ctx.result.output.slice(0, 10000) + '\n... truncated'
  }
})
```

**Event Bus**（与 Hook 互补）：

```typescript
type EventName = 
  | 'agent:start'
  | 'agent:end'
  | 'llm:call'
  | 'llm:response'
  | 'tool:call'
  | 'tool:result'
  | 'tool:approved'
  | 'tool:denied'
  | 'context:compressed'
  | 'memory:stored'
  | 'memory:retrieved'
  | 'skill:activated'
  | 'skill:deactivated'
  | 'provider:fallback'
  | 'error'

// 订阅（只读，不影响 Agent 行为）
agent.on('tool:call', (event) => {
  telemetry.track('tool_usage', { tool: event.toolName })
})
```

### 3.9 日志与调试

**执行轨迹**：

```typescript
interface Trace {
  id: string
  startTime: number
  endTime: number
  steps: StepTrace[]
  totalTokens: number
  totalCost: number
}

interface StepTrace {
  step: number
  llmInput: Message[]
  llmOutput: Message
  toolCalls?: ToolCallTrace[]
  duration: number
  tokens: { input: number; output: number }
}

interface ToolCallTrace {
  tool: string
  args: unknown
  result: unknown
  approved: boolean
  duration: number
}

// 回放
const trace = await agent.lastTrace()
await trace.replay({ stepByStep: true })
```

---

## 四、包结构

```
agentnova/
├── packages/
│   ├── core/                  # 核心引擎
│   │   ├── src/
│   │   │   ├── agent.ts       # Agent 类
│   │   │   ├── loop.ts        # ReAct 循环
│   │   │   ├── context.ts     # 上下文管理
│   │   │   ├── state.ts       # Agent 状态
│   │   │   └── index.ts
│   │   └── package.json
│   ├── tools/                 # 工具系统
│   │   ├── src/
│   │   │   ├── engine.ts      # 工具引擎
│   │   │   ├── registry.ts    # 工具注册表
│   │   │   ├── builtin/       # 内置工具
│   │   │   │   ├── fs.ts
│   │   │   │   ├── shell.ts
│   │   │   │   └── web.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── permission/            # 权限系统
│   │   ├── src/
│   │   │   ├── guard.ts       # 权限守卫
│   │   │   ├── rules.ts       # 规则引擎
│   │   │   ├── sandbox.ts     # 沙箱
│   │   │   └── index.ts
│   │   └── package.json
│   ├── memory/                # 记忆系统
│   │   ├── src/
│   │   │   ├── store.ts       # 存储抽象
│   │   │   ├── sqlite.ts      # SQLite 实现
│   │   │   ├── vector.ts      # 向量检索
│   │   │   ├── injector.ts    # 上下文注入
│   │   │   └── index.ts
│   │   └── package.json
│   ├── skills/                # 技能系统
│   │   ├── src/
│   │   │   ├── loader.ts      # 加载器
│   │   │   ├── registry.ts    # 注册中心
│   │   │   ├── isolator.ts    # 隔离
│   │   │   ├── market.ts      # 市场
│   │   │   └── index.ts
│   │   └── package.json
│   ├── providers/             # Provider 路由
│   │   ├── src/
│   │   │   ├── router.ts      # 路由器
│   │   │   ├── fallback.ts    # 降级链
│   │   │   ├── adapters/      # 适配器
│   │   │   │   ├── openai.ts
│   │   │   │   ├── anthropic.ts
│   │   │   │   └── custom.ts  # 国产模型兼容
│   │   │   └── index.ts
│   │   └── package.json
│   └── cli/                   # 脚手架工具
│       ├── src/
│       │   ├── commands/
│       │   │   ├── create.ts   # create-agent
│       │   │   ├── add-tool.ts # add-tool
│       │   │   ├── add-skill.ts# add-skill
│       │   │   └── run.ts      # run-agent
│       │   └── index.ts
│       └── package.json
├── skills/                    # 官方技能包
│   ├── code-review/
│   ├── git-ops/
│   └── data-analysis/
└── package.json               # monorepo root
```

**安装方式**：

```bash
# 全安装
npm install agentnova

# 按需安装
npm install @agentnova/core
npm install @agentnova/tools
npm install @agentnova/memory
npm install @agentnova/skills
```

---

## 五、开发路线图

### Phase 1：核心骨架（2 周）

**目标**：跑通最基本的 Agent Loop

- [x] 项目初始化（monorepo + tsconfig + vitest）
- [ ] `@agentnova/core` — Agent 类 + ReAct 循环
- [ ] `@agentnova/tools` — 工具定义 + 注册 + 执行
- [ ] `@agentnova/providers` — Provider 适配（OpenAI + 一个国产模型）
- [ ] 基础验证：3 步以内工具调用跑通

**验收标准**：
```typescript
const agent = createAgent({ model: 'gpt-4o' })
agent.registerTool(readFile)
const result = await agent.run('读取 package.json 的内容')
// 能正确调用 readFile 并返回结果
```

### Phase 2：安全 & 上下文（2 周）

**目标**：可用且安全

- [ ] `@agentnova/permission` — 权限三级模型 + 审批回调
- [ ] `@agentnova/core` — Context Manager（对话压缩 + 窗口策略）
- [ ] 资源限制（maxSteps / timeout / token 限制）
- [ ] 中断/取消支持

**验收标准**：
```typescript
const agent = createAgent({
  model: 'gpt-4o',
  permissions: {
    mode: 'ask',
    onApprovalNeeded: (req) => showApprovalUI(req),
  },
  limits: { maxSteps: 20, timeoutMs: 120000 },
})
// 危险操作弹出审批，长对话不爆 token
```

### Phase 3：记忆 & 技能（2 周）

**目标**：有记忆、可扩展

- [ ] `@agentnova/memory` — 三层记忆架构
  - Working Memory（内存）
  - Project Memory（AGENT.md）
  - Long-term Memory（SQLite + 语义检索）
- [ ] `@agentnova/skills` — Skill 加载 + 隔离
  - SKILL.md 解析
  - skill.config.ts 解析
  - 按需激活
- [ ] 内置 Skill：code-review, git-ops

**验收标准**：
```typescript
const agent = createAgent({
  model: 'gpt-4o',
  skills: ['./skills/code-review', './skills/git-ops'],
})

// 第一次执行后记住偏好，第二次自动应用
await agent.run('帮我 review 这段代码，我喜欢函数式风格')
await agent.run('再 review 一次') // 自动使用函数式标准
```

### Phase 4：体验打磨（2 周）

**目标**：生产可用

- [ ] 生命周期钩子系统
- [ ] Event Bus
- [ ] 结构化日志 + 执行轨迹回放
- [ ] Provider 降级链 + 模型路由
- [ ] Skill 市场（Git 仓库共享）
- [ ] CLI 脚手架工具
- [ ] 完整 TypeScript 类型导出
- [ ] 文档 & 示例

**验收标准**：
```bash
# 30 秒创建新 Agent 项目
npx agentnova create my-agent
cd my-agent
npm run dev
# 能跑、能调、能扩展
```

---

## 六、技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| LLM 框架 | Vercel AI SDK | provider-agnostic、流式支持好、类型安全、社区活跃 |
| 参数校验 | Zod | Vercel AI SDK 原生集成，工具定义用 Zod schema |
| 记忆存储 | better-sqlite3 | 零依赖、单文件、嵌入式、性能好 |
| 向量检索 | 本地 embedding + 余弦相似度 | 初期不依赖外部向量库，轻量起步 |
| Monorepo | pnpm workspace + turborepo | TypeScript monorepo 最佳实践 |
| 测试 | vitest | 快、ESM 原生、与 Vercel AI SDK 生态一致 |
| 构建 | tsup | 简洁、双格式输出（CJS+ESM）、dts 生成 |
| 沙箱 | 子进程 + 资源限制 | 初期轻量方案，后续可考虑 Docker |

---

## 七、与 Vercel AI SDK 的关系

**不重复造轮子**，Vercel AI SDK 提供的我们直接用：

| 功能 | Vercel AI SDK 提供 | AgentNova 补充 |
|------|-------------------|---------------|
| LLM 调用 | ✅ generateText / streamText | — |
| Provider 适配 | ✅ openai / anthropic / custom | 路由 + 降级策略 |
| 工具定义 | ✅ tool() + Zod | 权限声明 + 审批流程 |
| 多步循环 | ✅ maxSteps | 状态管理 + 中断控制 |
| 流式输出 | ✅ streamText | 事件流封装 |
| 结构化输出 | ✅ generateObject | — |

**AgentNova 聚焦 Vercel AI SDK 不覆盖的**：权限模型、记忆系统、技能加载、上下文压缩、审批流程、执行轨迹。

---

## 八、风险 & 缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 国产模型 tool calling 兼容性差 | 工具调用不稳定 | 封装兼容层 + 降级到 prompt-based tool calling |
| 上下文压缩损失信息 | Agent 忘记关键信息 | 关键信息标记优先级 + 压缩后校验 |
| Skill 间冲突 | 多技能激活时工具冲突 | 命名空间隔离 + 冲突检测 |
| 语义检索质量问题 | 记忆检索不准 | 可配置 embedding 模型 + 混合检索（关键词+语义） |
| Vercel AI SDK 破坏性更新 | 上游依赖不稳 | 锁版本 + 适配层抽象 |

---

## 九、命名

**AgentNova** ✨

新星——轻量、明亮、充满可能。
