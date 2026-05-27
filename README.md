# AgentNova ✨

> 借鉴 Claude Code 核心设计，基于 Vercel AI SDK 构建的通用 Agent 开发框架

## 特性

- 🔧 **Tool-First** — 工具是 Agent 的手脚，一切能力通过工具暴露
- 🛡️ **Safe-by-Default** — 危险操作默认拦截，显式授权才放行
- 🧠 **Context-Aware** — 智能上下文管理，不浪费一个 token
- 🧩 **Skill-Driven** — 能力模块化，按需加载，即插即用
- 🔄 **Multi-Provider** — 多 LLM 适配，自动降级

## 快速开始

```bash
# 创建项目
npx agentnova create my-agent
cd my-agent
pnpm install

# 运行
pnpm dev "帮我看看当前目录有什么文件"
```

## 编程使用

```typescript
import { createAgent } from '@agentnova/core'
import { fsTools, shellTools } from '@agentnova/tools'
import { createRouter, deepseekChat } from '@agentnova/providers'

const agent = createAgent({
  systemPrompt: '你是一个智能助手，帮助用户完成任务。',
  workingDir: process.cwd(),
  router: createRouter([deepseekChat()], 'deepseek-chat'),
  tools: [...fsTools, ...shellTools],
  permissions: {
    mode: 'ask',
    onApprovalNeeded: async (req) => {
      // 接入你的审批 UI
      return 'allow-once'
    },
  },
})

const result = await agent.run('读取 package.json 并分析依赖')

console.log(result.text)
console.log(`Steps: ${result.steps.length}, Tokens: ${result.state.totalTokensUsed}`)
```

## 自定义工具

```typescript
import { defineTool } from '@agentnova/tools'
import { z } from 'zod'

const myTool = defineTool({
  name: 'my.search',
  description: '搜索内部知识库',
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
    limit: z.number().default(10),
  }),
  permission: { level: 'read', description: '搜索知识库' },
  execute: async ({ query, limit }, ctx) => {
    const results = await searchKnowledgeBase(query, limit)
    return results
  },
})

agent.registerTool(myTool)
```

## 技能系统

```typescript
import { SkillLoader, defineSkill } from '@agentnova/skills'

const loader = new SkillLoader()

// 从目录加载
await loader.loadFromDir('./skills/code-review')

// 按需激活
const active = await loader.activateForInput('帮我 review 这段代码')

// 获取激活技能的工具和提示词
const tools = loader.getActiveTools()
const prompts = loader.getActivePrompts()
```

## 架构

```
AgentNova SDK
├── @agentnova/core       — Agent 类 + ReAct 循环 + 状态 + 上下文
├── @agentnova/tools      — 工具定义 + 注册 + 执行 + 内置工具
├── @agentnova/permission — 权限守卫 + 审批 + 沙箱 + 资源限制
├── @agentnova/memory     — 三层记忆 (短期/项目/长期) + 语义检索
├── @agentnova/skills     — 技能加载 + 隔离 + 市场
├── @agentnova/providers  — 多 Provider 路由 + 降级
└── agentnova             — 统一入口 + CLI
```

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 测试
pnpm test

# 单包开发
cd packages/core && pnpm dev
```

## License

MIT
