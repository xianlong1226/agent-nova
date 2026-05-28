# AgentNova 使用指南

> 从零到生产，手把手带你构建 AI Agent 🔮

---

## 目录

- [1. 环境准备](#1-环境准备)
- [2. 5 分钟跑通第一个 Agent](#2-5-分钟跑通第一个-agent)
- [3. 项目结构详解](#3-项目结构详解)
- [4. 自定义工具开发](#4-自定义工具开发)
- [5. 接入不同 Provider](#5-接入不同-provider)
- [6. 记忆系统实战](#6-记忆系统实战)
- [7. 技能开发与发布](#7-技能开发与发布)
- [8. 权限与安全配置](#8-权限与安全配置)
- [9. 上下文管理策略](#9-上下文管理策略)
- [10. 执行追踪与调试](#10-执行追踪与调试)
- [11. 生命周期钩子](#11-生命周期钩子)
- [12. 生产环境最佳实践](#12-生产环境最佳实践)
- [13. 常见问题](#13-常见问题)

---

## 1. 环境准备

### 前置条件

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18 | 推荐 v20+ |
| pnpm | ≥ 8 | 包管理器 |
| TypeScript | ≥ 5.0 | 类型支持 |

### 获取 API Key

AgentNova 支持任何 OpenAI 兼容 API，选一个即可：

| Provider | 环境变量 | 获取地址 |
|----------|----------|----------|
| DeepSeek | `DEEPSEEK_API_KEY` | https://platform.deepseek.com |
| OpenAI | `OPENAI_API_KEY` | https://platform.openai.com |
| 通义千问 | `QWEN_API_KEY` | https://dashscope.console.aliyun.com |
| 智谱 GLM | `GLM_API_KEY` | https://open.bigmodel.cn |

### 安装

```bash
# 创建项目（推荐方式）
npx agentnova create my-agent
cd my-agent
pnpm install

# 或者手动安装到现有项目
pnpm add agentnova ai @ai-sdk/openai zod
```

---

## 2. 5 分钟跑通第一个 Agent

### Step 1: 配置密钥

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
# 方案一：DeepSeek（便宜好用）
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx

# 方案二：OpenAI
OPENAI_API_KEY=sk-xxxxxxxxxxxx

# 方案三：国产模型
QWEN_API_KEY=sk-xxxxxxxxxxxx
DEEPSEEK_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### Step 2: 最简代码

创建 `src/index.ts`：

```typescript
import { Agent, createRouter, fsTools } from 'agentnova'
import { createOpenAI } from '@ai-sdk/openai'

// 1️⃣ 配置 Provider
const deepseek = createOpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

// 2️⃣ 创建 Agent
const agent = new Agent({
  systemPrompt: '你是一个文件助手，帮助用户管理文件。用中文回复。',
  workingDir: process.cwd(),
  router: createRouter(
    [{ id: 'deepseek', model: deepseek('deepseek-chat'), name: 'DeepSeek' }],
    'deepseek',
  ),
  tools: [...fsTools],
  permissions: { mode: 'auto' },
})

// 3️⃣ 运行
const result = await agent.run('帮我看看当前目录有什么文件', {
  onStep: (step) => {
    if (step.text) process.stdout.write(step.text)
    if (step.toolCalls?.length) {
      console.log(`\n🔧 调用工具: ${step.toolCalls.map(tc => tc.tool).join(', ')}`)
    }
  },
})

console.log(`\n\n✅ 完成！步骤: ${result.steps.length} | 耗时: ${result.totalDurationMs}ms`)
```

### Step 3: 运行

```bash
npx tsx src/index.ts
```

你会看到 Agent 自动调用 `fs.listDir` 工具读取目录，然后用自然语言总结结果 🎉

---

## 3. 项目结构详解

使用 `agentnova create` 生成的项目结构：

```
my-agent/
├── .env                    # API 密钥配置
├── .env.example            # 密钥模板
├── .gitignore
├── AGENT.md                # Agent 项目记忆（自动生成）
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # Agent 入口
│   └── tools/              # 自定义工具目录
│       └── .gitkeep
└── skills/                 # 技能目录
    └── .gitkeep
```

### AGENT.md 是什么？

项目级记忆文件，Agent 每次运行前会自动读取。你可以在里面写：

```markdown
# My Agent 记忆

## 用户偏好
- 用中文回复
- 代码风格：函数式优先，命名用驼峰

## 项目约定
- 使用 pnpm
- 测试框架 vitest
- 提交格式 conventional commits
```

Agent 会根据这些偏好调整行为，不需要每次重复说明。

---

## 4. 自定义工具开发

### 用 CLI 生成模板

```bash
# 自动生成到 src/tools/<path>.ts
agentnova add-tool weather.query    # → src/tools/weather/query.ts
agentnova add-tool db.query         # → src/tools/db/query.ts
agentnova add-tool slack.notify     # → src/tools/slack/notify.ts
```

### 手动编写工具

```typescript
import { z } from 'zod'
import { defineTool } from 'agentnova'

export const weatherQuery = defineTool({
  // 工具名称（建议用命名空间）
  name: 'weather.query',

  // LLM 看到的描述（写清楚，LLM 才能正确调用）
  description: '查询指定城市的实时天气信息，返回温度、天气状况、湿度、风力',

  // Zod schema 定义参数（自动校验 + 生成 LLM 工具 schema）
  parameters: z.object({
    city: z.string().describe('城市名称，如"北京"、"上海"'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('温度单位'),
  }),

  // 权限声明
  permission: {
    level: 'read',        // read | write | dangerous
    description: '调用天气 API 获取公开天气数据',
  },

  // 执行逻辑
  execute: async ({ city, unit }, ctx) => {
    // ctx.logger 记录日志
    ctx.logger.info('Querying weather', { city, unit })

    // ctx.abortSignal 支持取消
    if (ctx.abortSignal.aborted) {
      return { error: '操作已取消' }
    }

    // ctx.askApproval 请求审批（危险操作时用）
    // const approved = await ctx.askApproval({ tool: 'weather.query', args: { city }, permission: { level: 'read' } })

    // 实际调用 API
    const res = await fetch(`https://api.weather.com/v1?city=${encodeURIComponent(city)}`)
    const data = await res.json()

    const temp = unit === 'fahrenheit' ? data.temp * 9/5 + 32 : data.temp
    return {
      city,
      temperature: `${temp}°${unit === 'fahrenheit' ? 'F' : 'C'}`,
      condition: data.condition,
      humidity: `${data.humidity}%`,
      wind: data.wind,
    }
  },
})
```

### 注册工具

```typescript
import { weatherQuery } from './tools/weather/query.js'

const agent = new Agent({
  // ...
  tools: [...fsTools, ...shellTools, weatherQuery],
})

// 或者动态注册
agent.registerTool(weatherQuery)
```

### 工具开发要点

1. **描述要写清楚** — LLM 依赖描述决定什么时候调用这个工具
2. **参数用 `.describe()`** — 每个字段都加上描述，帮助 LLM 正确传参
3. **权限要准确** — `read` 自动放行，`write` 需确认，`dangerous` 默认拒绝
4. **返回结构化数据** — 方便 LLM 理解结果，避免返回大段文本
5. **处理错误** — 返回 `{ error: '...' }` 而不是抛异常（异常会中断 Agent）

---

## 5. 接入不同 Provider

### DeepSeek（推荐入门）

```typescript
import { createOpenAI } from '@ai-sdk/openai'

const deepseek = createOpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

const provider = { id: 'deepseek', model: deepseek('deepseek-chat'), name: 'DeepSeek' }
```

### OpenAI GPT-4o

```typescript
import { createOpenAI } from '@ai-sdk/openai'

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const provider = { id: 'openai', model: openai('gpt-4o'), name: 'GPT-4o' }
```

### 通义千问 Qwen

```typescript
const qwen = createOpenAI({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.QWEN_API_KEY,
})

const provider = { id: 'qwen', model: qwen('qwen-max'), name: 'Qwen Max' }
```

### Anthropic Claude

```typescript
import { anthropic } from '@ai-sdk/anthropic'

const provider = {
  id: 'claude',
  model: anthropic('claude-sonnet-4-20250514'),
  name: 'Claude Sonnet 4',
}
```

### 多 Provider + 降级链

```typescript
const router = createRouter(
  [
    { id: 'deepseek', model: deepseek('deepseek-chat'), name: 'DeepSeek',
      costInputPer1M: 0.14, costOutputPer1M: 0.28 },
    { id: 'qwen', model: qwen('qwen-max'), name: 'Qwen Max',
      costInputPer1M: 1.6, costOutputPer1M: 6.4 },
    { id: 'openai', model: openai('gpt-4o'), name: 'GPT-4o',
      costInputPer1M: 2.5, costOutputPer1M: 10 },
  ],
  'deepseek',                      // 默认用最便宜的
  ['deepseek', 'qwen', 'openai'],  // 降级链：deepseek 挂了 → qwen → openai
)

const agent = new Agent({
  // ...
  router,
})
```

当 DeepSeek 返回 429（限流）或超时时，Agent 自动切换到 Qwen，再失败切换到 OpenAI，确保不会因为单个 Provider 故障导致任务失败。

---

## 6. 记忆系统实战

AgentNova 的三层记忆：

```
┌─────────────────────────────────────────┐
│  Working Memory（内存）                    │  ← 当前会话，重启消失
├─────────────────────────────────────────┤
│  Project Memory（AGENT.md）               │  ← 项目级，文件持久化
├─────────────────────────────────────────┤
│  Long-term Memory（SQLite + 语义检索）      │  ← 跨项目，永久保存
└─────────────────────────────────────────┘
```

### 存储记忆

```typescript
// 工作记忆（当前会话）
await agent.remember('task_context', '用户正在重构 auth 模块', 'working')

// 项目记忆（AGENT.md，下次启动还在）
await agent.remember('project_style', '偏好函数式编程，不用 class', 'project')

// 长期记忆（跨项目持久化，需要配置 longTermMemory）
await agent.remember('react_pattern', 'useEffect 依赖数组不能漏，否则无限循环', 'longterm')
```

### 记忆如何生效

每次 `agent.run()` 执行前，会自动：
1. 读取 AGENT.md（项目记忆）
2. 语义检索与当前问题最相关的长期记忆
3. 将所有相关记忆注入 Agent 上下文

你不需要手动检索，Agent 自动找到最相关的记忆。

### 长期记忆配置

```typescript
const agent = new Agent({
  // ...
  longTermMemory: {
    dbPath: './data/memory.db',
    embeddingDim: 384,
    embedFn: async (text: string) => {
      // 接入你的 embedding 服务
      const res = await fetch('https://api.example.com/embed', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      return (await res.json()).embedding
    },
  },
})
```

没有 embedding 服务？也可以用，会退化为关键词搜索。

---

## 7. 技能开发与发布

### 什么是 Skill？

Skill = **提示词** + **专属工具** + **知识库** + **配置**

可以让 Agent 在特定场景下获得专业能力。

### 用 CLI 生成技能模板

```bash
agentnova add-skill code-review
```

生成目录结构：

```
skills/code-review/
├── skill.config.json   # 技能配置
├── SKILL.md            # 技能提示词（LLM 读取）
├── tools/              # 技能专属工具
│   └── index.ts
└── knowledge/          # 技能知识库
    └── .gitkeep
```

### 编写 skill.config.json

```json
{
  "name": "code-review",
  "version": "1.0.0",
  "description": "代码审查技能 — 发现 bug、安全漏洞和性能问题",
  "prompt": "SKILL.md",
  "tools": ["tools/lint.json", "tools/diff.json"],
  "knowledge": ["knowledge/best-practices.md", "knowledge/security-checklist.md"],
  "defaultConfig": {
    "strictness": "normal",
    "lintRules": []
  }
}
```

### 编写 SKILL.md

这是 LLM 读取的提示词，决定 Agent 在这个技能下的行为：

```markdown
# Code Review Skill

## 能力
审查代码质量，发现问题并给出结构化审查报告。

## 何时使用
- 用户要求 review 代码
- 提交 PR 前

## 审查工作流程
1. 读取变更文件和 diff
2. 理解改动意图
3. 按维度审查：正确性、安全性、性能、可维护性
4. 输出分级报告（🔴 严重 → 🟡 建议 → 🟢 做得好）
```

### 在 Agent 中使用

```typescript
const agent = new Agent({
  // ...
  skillDirs: ['skills'],
})
```

Agent 会自动根据用户输入激活匹配的技能。

### 发布技能到团队

```bash
# 方式一：发布到 Git 仓库
agentnova skill publish code-review --remote git@github.com:your-team/skills.git

# 方式二：发布到 npm
agentnova skill publish code-review --registry https://registry.npmjs.org

# 预览（不实际推送）
agentnova skill publish code-review --remote git@github.com:... --dry-run
```

### 安装别人的技能

```bash
# 从 Git 安装
agentnova skill install https://github.com/your-team/code-review-skill.git

# 从 npm 安装
agentnova skill install @agentnova/skill-code-review

# 查看已安装
agentnova skill list

# 搜索
agentnova skill search "code review"

# 卸载
agentnova skill uninstall code-review
```

---

## 8. 权限与安全配置

### 三种模式

```typescript
permissions: {
  mode: 'auto',    // 自动放行所有操作（开发环境用）
  // mode: 'ask',  // 危险操作弹窗确认
  // mode: 'deny', // 只读，拒绝所有写操作
}
```

### 细粒度规则

```typescript
permissions: {
  mode: 'ask',
  rules: [
    // 文件读操作自动放行
    { tool: 'fs.readFile', level: 'read' },

    // 写文件只允许 src 目录
    { tool: 'fs.writeFile', level: 'write', scope: ['src/**'] },

    // Shell 命令分类处理
    { tool: 'shell.exec', level: 'read', scope: ['ls *', 'cat *', 'git status'] },
    { tool: 'shell.exec', level: 'write', scope: ['npm *', 'pnpm *', 'git add *'] },

    // 禁止删除命令
    { tool: 'shell.exec', level: 'dangerous', scope: ['rm *'], mode: 'deny' },
  ],
}
```

### 审批回调

接入你自己的审批 UI：

```typescript
permissions: {
  mode: 'ask',
  onApprovalNeeded: async (request) => {
    // request: { tool, args, permission, reason }
    const choice = await showApprovalDialog(request)
    return choice  // 'allow-once' | 'allow-always' | 'deny'
  },
}
```

### 沙箱配置

```typescript
permissions: {
  sandbox: {
    enabled: true,
    cwd: '/project',                    // 限制工作目录
    allowedDirs: ['/project/src'],      // 可访问目录白名单
    blockedCommands: [                   // 命令黑名单
      'rm -rf /',
      'curl | sh',
      'chmod 777',
    ],
    maxFileSize: 10 * 1024 * 1024,      // 文件大小限制 10MB
  },
}
```

---

## 9. 上下文管理策略

长对话会消耗大量 token，ContextManager 自动压缩避免超限。

### 基本配置

```typescript
const agent = new Agent({
  // ...
  context: {
    preserveRecentTurns: 10,               // 保留最近 10 轮完整对话
    compressionTriggerRatio: 0.7,          // 达到窗口 70% 时触发压缩
    compressionStrategy: 'summary',        // 压缩策略
    maxToolOutputLength: 8000,             // 工具输出最大长度
    toolOutputTruncate: 'tail',            // 截断策略：保留尾部
  },
})
```

### 压缩策略对比

| 策略 | 方式 | 优点 | 缺点 |
|------|------|------|------|
| `summary` | 用 LLM 生成摘要 | 保留语义 | 额外 token 消耗 |
| `sliding-window` | 直接丢弃旧轮 | 零成本 | 丢失信息 |
| `hybrid` | 摘要 + 关键信息提取 | 平衡 | 实现复杂 |

### 工具输出截断

Agent 调用工具可能返回大量文本（如 `cat` 大文件），配置截断避免浪费 token：

```typescript
context: {
  maxToolOutputLength: 4000,   // 超过 4000 字符截断
  toolOutputTruncate: 'tail',  // 'tail' 保留末尾 | 'head' 保留开头
}
```

---

## 10. 执行追踪与调试

### 获取执行轨迹

```typescript
const result = await agent.run('帮我整理项目')

// 获取完整轨迹
const trace = agent.getTrace()
console.log(`总步骤: ${trace.entries.length}`)
console.log(`总 Token: ${trace.totalTokens}`)
console.log(`预估费用: $${trace.estimatedCost.toFixed(4)}`)
```

### 轨迹回放

```typescript
const replay = agent.replayTrace()
console.log(replay.summary())
// 输出：5 步，3 次工具调用，2 次 LLM 调用，总耗时 3200ms
```

### 结构化日志

```typescript
const logger = agent.getLogger()

// 在工具执行中记录
logger.info('file_processed', { file: 'src/index.ts', lines: 150 })
logger.warn('large_output', { size: '15KB', truncated: true })
logger.error('api_failed', { provider: 'deepseek', error: '429 Rate Limit' })

// 导出日志
console.log(logger.exportNDJSON())
```

### Usage 追踪

```typescript
const usage = agent.getUsage()
console.log(`输入 Token: ${usage.inputTokens}`)
console.log(`输出 Token: ${usage.outputTokens}`)
console.log(`总 Token: ${usage.totalTokens}`)
console.log(`预估费用: $${usage.estimatedCost.toFixed(4)}`)
```

---

## 11. 生命周期钩子

在 Agent 执行的关键节点注入自定义逻辑。

### 可用钩子

| 钩子 | 时机 | 用途 |
|------|------|------|
| `onStart` | Agent 开始执行 | 初始化 |
| `onBeforeLLMCall` | LLM 调用前 | 修改 prompt |
| `onAfterLLMCall` | LLM 响应后 | 日志、审计 |
| `onBeforeToolCall` | 工具执行前 | 拦截、修改参数 |
| `onAfterToolCall` | 工具执行后 | 修改结果、日志 |
| `onEnd` | Agent 执行结束 | 清理、通知 |
| `onError` | 出错时 | 告警、兜底 |

### 示例：拦截危险操作

```typescript
agent.hook('onBeforeToolCall', async (ctx) => {
  if (ctx.toolCall.tool === 'shell.exec') {
    const cmd = ctx.toolCall.args.cmd as string
    // 阻止删除操作
    if (/rm\s+-rf/.test(cmd)) {
      return { action: 'deny', reason: '不允许执行 rm -rf 命令' }
    }
    // 阻止网络请求到内网
    if (/192\.168\.|10\.0\./.test(cmd)) {
      return { action: 'deny', reason: '不允许访问内网地址' }
    }
  }
})
```

### 示例：工具结果裁剪

```typescript
agent.hook('onAfterToolCall', async (ctx) => {
  if (ctx.toolResult.output && typeof ctx.toolResult.output === 'string') {
    if (ctx.toolResult.output.length > 5000) {
      ctx.toolResult.output = ctx.toolResult.output.slice(0, 5000) + '\n... [truncated]'
    }
  }
})
```

### 示例：调用链路追踪

```typescript
agent.hook('onBeforeLLMCall', async (ctx) => {
  console.log(`[Step ${ctx.step}] 调用 LLM，消息数: ${ctx.messages?.length}`)
})

agent.hook('onAfterLLMCall', async (ctx) => {
  console.log(`[Step ${ctx.step}] LLM 响应完成`)
})

agent.hook('onBeforeToolCall', async (ctx) => {
  console.log(`[Step ${ctx.step}] 🔧 ${ctx.toolCall.tool}`)
})

agent.hook('onAfterToolCall', async (ctx) => {
  const status = ctx.toolResult.error ? '❌' : '✅'
  console.log(`[Step ${ctx.step}] ${status} ${ctx.toolCall.tool} (${ctx.toolResult.durationMs}ms)`)
})
```

---

## 12. 生产环境最佳实践

### Provider 配置

```typescript
// ✅ 推荐：多 Provider 降级链
const router = createRouter(
  [
    { id: 'primary', model: deepseek('deepseek-chat'), name: 'DeepSeek' },
    { id: 'fallback1', model: qwen('qwen-max'), name: 'Qwen' },
    { id: 'fallback2', model: openai('gpt-4o'), name: 'GPT-4o' },
  ],
  'primary',
  ['primary', 'fallback1', 'fallback2'],
)
```

### 权限配置

```typescript
// ✅ 生产环境用 'ask' 模式，危险操作需确认
permissions: {
  mode: 'ask',
  rules: [
    { tool: 'fs.readFile', level: 'read' },
    { tool: 'fs.writeFile', level: 'write', scope: ['/project/**'] },
    { tool: 'shell.exec', level: 'dangerous', mode: 'deny', scope: ['rm *', 'chmod *'] },
  ],
  sandbox: { enabled: true, cwd: '/project' },
}
```

### 资源限制

```typescript
permissions: {
  limits: {
    maxSteps: 50,              // 最多 50 步
    timeoutMs: 300000,         // 5 分钟超时
    maxTokens: 200000,         // token 上限
    maxToolCalls: 100,         // 最多调用 100 次工具
    maxFileSize: 10 * 1024 * 1024,  // 单文件 10MB 上限
  },
}
```

### 流式输出体验

```typescript
// 流式输出让用户更快看到结果
const result = await agent.runStream(prompt, {
  onText: (chunk) => process.stdout.write(chunk),
  onStep: (step) => {
    if (step.toolCalls?.length) {
      console.log(`\n🔧 ${step.toolCalls.map(tc => tc.tool).join(', ')}`)
    }
  },
})
```

### 中断与取消

```typescript
const controller = new AbortController()

// 10 秒后自动取消
setTimeout(() => controller.abort(), 10000)

const result = await agent.run(prompt, {
  signal: controller.signal,
})

// 或手动中断
agent.abort()
```

### 成本控制

```typescript
// 监控每次运行的费用
const result = await agent.run(prompt)

if (result.usage) {
  console.log(`本次费用: $${result.usage.estimatedCost.toFixed(4)}`)
  console.log(`Token 用量: ${result.usage.totalTokens}`)
}

// 设置总费用告警
const globalUsage = agent.getUsage()
if (globalUsage.estimatedCost > 1.0) {
  console.warn('⚠️ 累计费用超过 $1.00')
}
```

---

## 13. 常见问题

### Q: 支持哪些模型？

任何 OpenAI 兼容 API 都支持。包括：OpenAI GPT 系列、DeepSeek、通义千问、智谱 GLM、Moonshot、零一万物等。Claude 通过 `@ai-sdk/anthropic` 适配。

### Q: 必须用 pnpm 吗？

CLI 创建的项目默认用 pnpm，但你也可以手动安装到任何包管理器项目中。SDK 本身无包管理器依赖。

### Q: 记忆数据存在哪里？

- Working Memory：内存，随进程消失
- Project Memory：`AGENT.md` 文件，在你项目根目录
- Long-term Memory：SQLite 文件，在你配置的 `dbPath`

### Q: 如何调试工具调用？

```typescript
agent.hook('onBeforeToolCall', async (ctx) => {
  console.log('→', ctx.toolCall.tool, JSON.stringify(ctx.toolCall.args).slice(0, 200))
})

agent.hook('onAfterToolCall', async (ctx) => {
  console.log('←', ctx.toolResult.error ?? JSON.stringify(ctx.toolResult.output).slice(0, 200))
})
```

### Q: 如何限制 Agent 只能读文件不能写？

```typescript
permissions: {
  mode: 'auto',
  rules: [
    { tool: 'fs.readFile', level: 'read' },
    { tool: 'fs.writeFile', level: 'write', mode: 'deny' },
    { tool: 'shell.exec', level: 'dangerous', mode: 'deny' },
  ],
}
```

### Q: 为什么 Agent 循环调用同一个工具？

这是 LLM 的 ReAct 幻觉问题。AgentNova 内置了 LoopDetector，连续调用相同工具和参数时会自动终止。你也可以配置：

```typescript
context: {
  loopDetection: {
    enabled: true,
    historySize: 30,          // 检测最近 30 次调用
    warningThreshold: 10,     // 10 次重复发出警告
    criticalThreshold: 20,    // 20 次重复直接终止
  },
}
```

### Q: 可以在浏览器里用吗？

AgentNova 是 Node.js SDK，使用了 `fs`、`child_process` 等 Node API，不能直接在浏览器运行。如需浏览器端 Agent，可以考虑只使用 `@agentnova/core` 的部分功能。

---

## 下一步

- 📖 [API 参考文档](./API.md) — 查看完整接口定义
- 🏗️ [项目方案](../PROJECT.md) — 了解架构设计决策
- 💡 [示例代码](../examples/) — 3 个可运行的示例项目

有问题？提 Issue 或直接找宙斯 🔮
