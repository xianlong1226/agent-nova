# AgentNova SDK

极简 AI Agent 开发框架，TypeScript 原生支持。10 行代码起步，支持任意 OpenAI 兼容端点。

## 设计哲学

- **Tool-First** —— 一切能力通过工具暴露，Zod 类型安全，工具即接口
- **Safe-by-Default** —— 危险操作默认进入 `ask` 审批模式，显式授权才放行
- **Context-Aware** —— LLM 摘要 + 语义评分 + 主动压缩，token 不浪费在重复上下文
- **Skill-Driven** —— 能力模块化，按需激活，知识 + 工具 + 提示词三位一体
- **Multi-Provider** —— 任意 OpenAI 兼容端点 + 自动降级链 + 429 自适应退避
- **渐进式复杂度** —— 从 `quickAgent` 一行起步，到 `new Agent({...})` 深度配置，每一步都能跑

## 安装

```bash
pnpm add agentnova ai @ai-sdk/openai zod
```

## 快速开始

```typescript
import {
  Agent,
  createRouter,
  createOpenAICompatibleProvider,
  fsTools,
  shellTools,
} from 'agentnova'

const provider = createOpenAICompatibleProvider({
  id: 'deepseek',
  name: 'DeepSeek',
  model: 'deepseek-chat',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY!,
})

const agent = new Agent({
  systemPrompt: '你是一个智能助手，用中文回复。',
  workingDir: process.cwd(),
  router: createRouter([provider], provider.id),
  tools: [...fsTools, ...shellTools],
})

const result = await agent.run('帮我看看当前目录有哪些文件')
console.log(result.text)
console.log(`耗时 ${result.totalDurationMs}ms，费用 $${result.usage.estimatedCost.toFixed(4)}`)
```

## CLI 命令

```bash
# 创建项目
agentnova create my-agent

# 添加自定义工具（支持命名空间路径）
agentnova add-tool db.query        # → src/tools/db/query.ts
agentnova add-tool slack.notify    # → src/tools/slack/notify.ts

# 添加技能模板
agentnova add-skill code-review    # → skills/code-review/

# 在项目中运行 Agent
agentnova run "帮我整理项目文件"

# 技能管理
agentnova skill list               # 列出已安装技能
agentnova skill search <query>     # 搜索技能
agentnova skill install <source>   # 从 Git/npm 安装技能
agentnova skill uninstall <name>   # 卸载技能
agentnova skill publish <name>     # 打包技能用于分发
```

## 使用方法

### 流式输出

```typescript
const result = await agent.runStream('分析项目结构', {
  maxSteps: 10,
  onStep: (step) => {
    if (step.text) process.stdout.write(step.text)
    for (const call of step.toolCalls ?? []) {
      console.log(`\n🔧 ${call.tool}`)
    }
  },
})
```

`run()` 与 `runStream()` 共享同一执行循环，工具调用、权限、追踪行为完全一致。

### 多 Provider 与自动降级

```typescript
import { createRouter, createOpenAICompatibleProvider } from 'agentnova'

const deepseek = createOpenAICompatibleProvider({ id: 'deepseek', /* ... */ })
const openai   = createOpenAICompatibleProvider({ id: 'openai',   /* ... */ })
const qwen     = createOpenAICompatibleProvider({ id: 'qwen',     /* ... */ })

const router = createRouter(
  [deepseek, openai, qwen],
  'deepseek',                    // 默认 Provider
  ['deepseek', 'qwen', 'openai'] // 降级链
)
```

主 Provider 失败、超时或 5xx 时自动切到下一个；429 触发自适应退避；认证错误不降级直接抛出。

### 权限控制

```typescript
const agent = new Agent({
  // ...
  permissions: {
    mode: 'ask',
    rules: [
      { tool: 'fs.writeFile', mode: 'ask',   scope: ['src/**'] },
      { tool: 'shell.exec',   mode: 'deny',  scope: ['rm -rf'] },
    ],
    sandbox: {
      allowedDirs: ['/project/src'],
      blockedCommandPatterns: [/rm\s+-rf\s+\//, /curl.*\|\s*sh/],
      maxFileSize: 1024 * 1024,
    },
    // 触发 ask 时回调，返回 allow-once / allow-always / deny
    onApprovalNeeded: async (req) => {
      console.log(`需要授权：${req.tool}（${req.permission.level}）`)
      return 'allow-once'
    },
  },
})
```

读操作默认放行，写操作和命令执行默认进入 `ask`；返回 `allow-always` 后会缓存到 always-allowed，下次自动通过。

### 自定义工具

```typescript
import { defineTool } from 'agentnova'
import { z } from 'zod'

const weatherTool = defineTool({
  name: 'weather.query',
  description: '查询指定城市天气',
  parameters: z.object({
    city: z.string(),
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  permission: { level: 'read' },
  execute: async ({ city, unit }) => {
    // 调用真实天气 API
    return { city, temperature: '26°C', condition: '晴' }
  },
})

const agent = new Agent({ /* ... */ tools: [weatherTool] })
```

### 自定义 Provider 端点

任意 OpenAI 兼容端点（DeepSeek / 通义千问 / 智谱 / Ollama / 自托管）一行接入：

```typescript
const provider = createOpenAICompatibleProvider({
  id: 'qwen',
  name: 'Qwen Max',
  model: 'qwen-max',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.QWEN_API_KEY!,
  costInputPer1M: 1.6,
  costOutputPer1M: 6.4,
})
```

需要更精细控制（自定义 fetch / headers）时可下沉到 `@ai-sdk/openai` 的 `createOpenAI`，再包成 `ProviderConfig` 传给 `createRouter`。

### 记忆系统

```typescript
const agent = new Agent({
  // ...
  longTermMemory: {
    dbPath: './data/memory.db',
  },
})

// 三层记忆按需写入
await agent.remember('user_preference', '喜欢简洁代码风格', 'project')
await agent.remember('bug_fix', 'React useEffect 依赖数组不能漏', 'longterm')
```

- **WorkingMemory** —— 单次 `run()` 内的 KV 存储
- **ProjectMemory** —— 写入 `AGENT.md`，可读可编辑、版本控制友好
- **LongTermMemory** —— sql.js 持久化 + 重要性衰减 + 主动淘汰
- **MemoryInjector** —— 每轮自动按 token 预算注入最相关记忆

### 技能（Skill）

把 `skillDirs` 交给 Agent，SDK 自动扫描、解析、按输入激活：

```typescript
const agent = new Agent({
  // ...
  skillDirs: [path.resolve(__dirname, '../../skills')],
})

agent.on('skill:activated', (e) => {
  console.log('已激活：', e.data.skills)
})
```

每个技能目录形如：

```
skills/code-review/
├── skill.config.json   # 元数据 + activateOn 谓词
├── SKILL.md            # 注入到 system prompt 的指令
├── tools/              # 技能专属工具定义
└── knowledge/          # 知识库文档
```

激活后会注入 SKILL.md 到 system prompt、注册技能工具、加载知识库；未命中时不消耗任何 token。

### 钩子

```typescript
agent.hook('onBeforeToolCall', async (ctx) => {
  if (ctx.toolCall.tool === 'shell.exec' && /rm\s+-rf/.test(String(ctx.toolCall.args.cmd))) {
    return { action: 'deny', reason: '不允许删除文件' }
  }
})

agent.hook('onAfterToolCall', async (ctx) => {
  if (ctx.toolResult.error) console.error(`工具失败：${ctx.toolResult.error}`)
})
```

可用钩子：`onStart` / `onEnd` / `onBeforeLLMCall` / `onAfterLLMCall` / `onBeforeToolCall` / `onAfterToolCall`。

### 事件监听

```typescript
agent.on('step',                (e) => console.log(`Step ${e.data.step}`))
agent.on('tool:call',           (e) => console.log(`🔧 ${e.data.tool}`))
agent.on('tool:result',         (e) => console.log(`✅ ${e.data.tool}`))
agent.on('llm:call',            ()  => console.log('🤖 LLM 调用'))
agent.on('context:compressed',  ()  => console.log('🗜️ 上下文已压缩'))
agent.on('provider:fallback',   (e) => console.log(`🔄 降级：${e.data.from} → ${e.data.to}`))
agent.on('skill:activated',     (e) => console.log('✨ 技能激活', e.data.skills))
agent.on('agent:end',           (e) => console.log(`✅ 完成，${e.data.steps} 步`))
```

### 执行追踪与日志

```typescript
const trace = agent.getTrace()
console.log(`${trace.entries.length} 条记录`)

const logger = agent.getLogger()
logger.info('custom_event', { detail: '...' })

const usage = agent.getUsage()
console.log(`Tokens: ${usage.totalTokens}，费用 $${usage.estimatedCost.toFixed(4)}`)
```

Trace 支持 `TraceReplay` 回放；StructuredLogger 写 NDJSON 文件、自动轮转、按采样率降噪。

## 示例工程

仓库 [examples/](./examples) 下有 9 个可独立运行的示例：

| 示例 | 演示内容 |
|------|---------|
| [01-basic](./examples/01-basic) | 最小 Agent + 交互式权限审批 |
| [02-custom-tool](./examples/02-custom-tool) | 用 `defineTool` 注册自定义工具 |
| [03-multi-provider](./examples/03-multi-provider) | 多 Provider 路由 + 降级链 |
| [04-custom-endpoint](./examples/04-custom-endpoint) | 接入任意 OpenAI 兼容端点 |
| [05-streaming-memory](./examples/05-streaming-memory) | 流式输出 + 长期记忆 |
| [06-use-skill](./examples/06-use-skill) | 通过 `skillDirs` 自动加载技能 |
| [07-context-config](./examples/07-context-config) | 上下文压缩与裁剪策略配置 |
| [08-session](./examples/08-session) | 多用户会话隔离 + 串行锁 + 持久化 |
| [09-tool-sandbox](./examples/09-tool-sandbox) | 工具沙箱：内置 Sandbox 配置 + 自定义 `preflight` 钩子 |

每个示例只需设置 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 即可运行：

```bash
cd examples/01-basic
LLM_BASE_URL=https://api.deepseek.com/v1 \
LLM_API_KEY=sk-xxx \
LLM_MODEL=deepseek-chat \
  pnpm start
```

## 文档导航

- [docs/GUIDE.md](./docs/GUIDE.md) —— 从零到生产的使用教程
- [docs/API.md](./docs/API.md) —— 完整 API 参考
- [PROJECT.md](./PROJECT.md) —— 项目结构与开发/调试指南（面向维护者）
- [ARCHITECTURE.md](./ARCHITECTURE.md) —— 架构设计文档（深度）

## License

MIT
