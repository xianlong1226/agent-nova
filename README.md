# AgentNova SDK

🔮 极简 AI Agent 开发框架，TypeScript 原生支持。

## 特性

- 🔧 **Tool-First** — 一切能力通过工具暴露，Zod 类型安全
- 🛡️ **Safe-by-Default** — 危险操作默认拦截，显式授权才放行
- 🧠 **Context-Aware** — 智能上下文压缩，不浪费 token
- 🧩 **Skill-Driven** — 能力模块化，按需加载
- 🔄 **Multi-Provider** — 模型路由 + 降级链，自动容错
- 📋 **Full Tracing** — 执行轨迹记录 + 回放，完整可观测

## 快速开始

```bash
# 创建项目
npx agentnova create my-agent
cd my-agent
pnpm install

# 运行
pnpm dev "帮我看看当前目录有什么文件"
```

## CLI 命令

```bash
# 创建新项目
agentnova create my-agent

# 添加自定义工具（支持命名空间路径如 db.query）
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

# 版本
agentnova --version
```

## 手动使用

```typescript
import {
  createAgent,
  createRouter,
  deepseekChat,
  fsTools,
  shellTools,
} from 'agentnova'

const agent = createAgent({
  systemPrompt: '你是一个智能助手，用中文回复。',
  workingDir: process.cwd(),
  router: createRouter([deepseekChat()], 'deepseek-chat'),
  tools: [...fsTools, ...shellTools],
})

// 非流式
const result = await agent.run('帮我创建一个新的 TypeScript 文件')

// 流式
const streamResult = await agent.runStream('分析项目结构', {
  onText: (chunk) => process.stdout.write(chunk),
  onStep: (step) => console.log(`Step ${step.step}`),
})

console.log('耗时:', result.totalDurationMs, 'ms')
console.log('Token:', result.usage.totalTokens)
console.log('费用:', `$${result.usage.estimatedCost.toFixed(4)}`)
```

## 多 Provider 降级

```typescript
import { createRouter, deepseekChat, openaiGPT4o, claudeHaiku35 } from 'agentnova'

const router = createRouter(
  [deepseekChat(), openaiGPT4o(), claudeHaiku35()],
  'deepseek-chat'
)

// Agent 会自动降级：deepseek 失败 → openai → claude
const agent = createAgent({
  systemPrompt: '...',
  workingDir: '.',
  router,
  tools: [...fsTools],
})
```

## 权限控制

```typescript
const agent = createAgent({
  // ...
  permissions: {
    mode: 'ask',
    rules: [
      { tool: 'fs.writeFile', level: 'ask', scope: ['src/**'] },
      { tool: 'shell.exec', level: 'dangerous', scope: ['npm test'] },
    ],
    sandbox: {
      enabled: true,
      allowedDirs: ['/project/src'],
      blockedCommands: ['rm -rf /', 'curl | sh'],
      maxFileSize: 1024 * 1024, // 1MB
    },
  },
})
```

## 记忆系统

```typescript
// 三层记忆架构
const agent = createAgent({
  // ...
  longTermMemory: {
    dbPath: './data/memory.db',
    embeddingFn: async (text: string) => {
      // 接入你的 embedding 服务
      return [0.1, 0.2, ...]
    },
  },
})

// 存储
await agent.remember('user_preference', '喜欢简洁的代码风格', 'project')
await agent.remember('bug_fix', 'React useEffect 依赖数组不能漏', 'longterm')

// 记忆会自动注入上下文——每轮对话前 Agent 自动检索最相关的记忆
```

## 技能系统

```typescript
// 安装技能
// npx agentnova skill install https://github.com/example/code-review-skill

// 项目内定义技能（skills/my-skill/skill.config.json）
{
  "name": "code-review",
  "version": "1.0.0",
  "description": "代码审查技能",
  "activateOn": "input.includes('review') || input.includes('审查')",
  "prompt": "你是一个代码审查专家...",
  "tools": [...],
  "knowledge": ["review-guidelines.md"]
}
```

## 执行追踪 & 日志

```typescript
const agent = createAgent({ ... })

const result = await agent.run('做点事情')

// 获取执行轨迹
const trace = agent.getTrace()
console.log(trace.steps.length, '步')
console.log(trace.totalTokens, 'tokens')

// 回放
const replay = agent.replayTrace()
console.log(replay.summary())

// 结构化日志
const logger = agent.getLogger()
logger.info('custom event', { detail: '...' })
console.log(logger.exportNDJSON())
```

## 钩子系统

```typescript
const agent = createAgent({ ... })

// 在 LLM 调用前修改消息
agent.hook('onBeforeLLMCall', async (ctx) => {
  console.log(`即将调用 LLM，步骤 ${ctx.step}`)
})

// 在工具调用后记录日志
agent.hook('onAfterToolCall', async (ctx) => {
  console.log(`工具 ${ctx.toolCall.tool} 完成`)
  if (ctx.toolResult.error) {
    console.error(`工具出错: ${ctx.toolResult.error}`)
  }
})

// 阻止危险操作
agent.hook('onBeforeToolCall', async (ctx) => {
  if (ctx.toolCall.tool === 'shell.exec' && ctx.toolCall.args.cmd?.includes('rm')) {
    return { action: 'deny', reason: '不允许删除文件' }
  }
})
```

## 事件监听

```typescript
const agent = createAgent({ ... })

agent.on('step', (event) => console.log(`Step ${event.data.step}`))
agent.on('tool:call', (event) => console.log(`🔧 ${event.data.tool}`))
agent.on('tool:result', (event) => console.log(`✅ ${event.data.tool}`))
agent.on('llm:call', (event) => console.log('🤖 LLM 调用'))
agent.on('context:compressed', () => console.log('🗜️ 上下文已压缩'))
agent.on('provider:fallback', (event) => console.log(`🔄 降级: ${event.data.from}`))
agent.on('agent:end', (event) => console.log(`✅ 完成，${event.data.steps} 步`))
```

## 包架构

```
@agentnova/core        — Agent 核心、上下文管理、Usage 追踪、Trace 记录
@agentnova/tools       — 工具注册表、工具引擎、内置 fs/shell 工具
@agentnova/permission  — 权限守卫、沙箱、命令黑名单
@agentnova/providers   — Provider 路由、降级链、多模型支持
@agentnova/memory      — 三层记忆系统（Working/Project/LongTerm）
@agentnova/skills      — 技能加载器、技能市场
agentnova              — 统一入口 + CLI
```

## License

MIT

---

📚 **更多文档**

- [使用指南](./docs/GUIDE.md) — 从零到生产，手把手教程
- [API 参考](./docs/API.md) — 完整接口文档
- [项目方案](./PROJECT.md) — 架构设计与技术决策
