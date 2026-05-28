# AgentNova SDK 🔮

> 通用 Agent 开发框架 —— 从原型到生产，一套代码搞定

## 一句话简介

AgentNova 是一个 TypeScript Agent 开发框架，提供上下文管理、记忆系统、工具执行、权限控制、Provider 路由的全链路解决方案。你在 10 行代码里创建的 Agent，和你上线后跑在生产环境的 Agent，是同一个。

---

## 核心能力

| 能力 | 说明 |
|------|------|
| **ReAct 主循环** | 多步推理 + 工具调用，直到任务完成或触发资源限制 |
| **智能上下文压缩** | 不是粗暴丢消息，而是 LLM 自动摘要 + 代词消解 + 语义优先级排序 |
| **三层记忆** | Working（会话内）→ Project（跨会话文件）→ LongTerm（SQLite + 重要性衰减） |
| **权限沙箱** | read/write/dangerous 三级 + 命令黑名单正则 + 路径白名单 + 审批回调 |
| **Provider 降级链** | 主 Provider 失败自动切换 fallback，429 自适应退避 |
| **并发安全** | 同一用户串行排队，不同用户完全并行，会话物理隔离 |
| **全链路追踪** | Trace 收集 → NDJSON 日志 + 文件轮转 → Trace Replay 回放 |
| **结构化错误** | 30+ 错误码 + 自动推理 + 重试策略映射，不再靠字符串匹配 |

---

## 项目结构

```
agent-sdk/
├── packages/
│   ├── core/          # Agent 核心：主循环、上下文、状态、追踪、错误
│   ├── tools/         # 工具系统：注册、执行、内置 fs/shell 工具
│   ├── permission/    # 权限系统：沙箱、降级链、审批回调
│   ├── memory/        # 记忆系统：三层记忆 + 重要性衰减 + 主动淘汰
│   ├── providers/     # Provider 路由：降级链 + 流控限流
│   ├── skills/        # 技能系统：加载、注册、市场、发布
│   └── agentnova/     # 统一入口：重新导出 + CLI + quickAgent 快捷创建
├── docs/
│   ├── API.md         # 接口参考手册（7 模块）
│   └── GUIDE.md       # 13 章使用教程
├── PROJECT.md         # 本文档
└── README.md
```

---

## 模块详解

### @agentnova/core（2,476 行 / 869 行测试）

Agent 的心脏。包含：

- **Agent 类**：ReAct 主循环，管理 `run()` / `runStream()` 两套执行路径
- **ContextManager**：token 预算感知的上下文压缩，支持 LLM 自动摘要
- **SessionManager**：并发锁 + 用户数据隔离 + JSON 文件持久化
- **UsageTracker**：精确成本追踪，支持 6 个 Provider 的定价数据
- **TraceCollector + TraceReplay**：全链路追踪和回放
- **StructuredLogger**：文件输出 + 轮转 + 采样率配置
- **AgentError**：30+ 结构化错误码 + 自动推理 + 重试策略

### @agentnova/tools（408 行 / 97 行测试）

工具注册与执行引擎：

- **ToolRegistry**：注册、查找、列举工具
- **ToolEngine**：执行工具调用，处理超时和错误
- **内置工具**：`fs.readFile`、`fs.writeFile`、`fs.listDir`、`fs.stat`、`shell.exec`
- **defineTool**：工具定义辅助函数，带 Zod 参数校验

### @agentnova/permission（286 行 / 255 行测试）

安全第一的权限系统：

- **PermissionGuard**：权限决策引擎，支持 allow/ask/deny 三种模式
- **沙箱配置**：路径白名单、命令黑名单（精确 + 正则）、文件大小限制
- **审批回调**：`askApproval(request) → allow-once | allow-always | deny`
- **always-allowed 缓存**：用户选择"总是允许"后自动跳过审批
- **默认规则**：读操作自动放行，写操作和命令执行需要审批

### @agentnova/memory（655 行 / 245 行测试）

三层记忆 + 智能衰减：

- **WorkingMemory**：内存中的 KV 存储，会话结束即消失
- **ProjectMemory**：基于 `AGENT.md` 文件的持久化记忆，跨会话保留
- **LongTermMemory**：SQLite（sql.js / 纯 WASM）持久化 + 语义搜索
- **MemoryInjector**：预算感知的记忆注入，窗口紧张时自动缩减注入量
- **重要性系统**：4 级（critical/high/normal/low）+ 半衰期衰减 + 自动分类
- **主动淘汰**：低于阈值的记忆自动清理

### @agentnova/providers（462 行 / 流控模块）

Provider 路由 + 流控：

- **ProviderRouter**：默认 Provider + 任务复杂度路由 + 降级链
- **RateLimiter**：令牌桶算法，全局 + 按 Provider 独立限流
- **自适应退避**：收到 429 自动加 backoff，成功后清除
- **预设 Provider**：GPT-4o、DeepSeek、Qwen、Claude Sonnet 4、Claude Haiku 3.5

### @agentnova/skills（466 行 / 8 行测试）

技能系统：

- **SkillLoader**：从目录加载技能（skill.config.json + SKILL.md + tools + knowledge）
- **SkillRegistry**：安装/卸载/搜索/发布技能
- **SkillLoaderWorker**：运行时技能激活（根据输入自动启用相关技能）
- **发布功能**：Git push 或 npm publish，支持 dry-run

### agentnova（687 行 / 13 行测试）

统一入口 + CLI：

- **重新导出**：所有子包的公共 API 一站式导入
- **quickAgent**：10 行代码创建带 fs + shell 内置工具的 Agent
- **CLI**：`create` 脚手架、`add-tool`/`add-skill` 模板生成、`run` 执行、`skill` 管理

---

## 快速开始

### 安装

```bash
pnpm add agentnova ai @ai-sdk/openai zod
```

### 10 行创建 Agent

```typescript
import { quickAgent } from 'agentnova'
import { createOpenAI } from '@ai-sdk/openai'

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

const agent = quickAgent({
  model: 'openai-gpt4o',
  router: createRouter(
    [{ id: 'openai-gpt4o', model: openai('gpt-4o') }],
    'openai-gpt4o',
  ),
  systemPrompt: '你是一个智能助手',
})

const result = await agent.run('当前目录有哪些文件？')
console.log(result.text)
```

### CLI 脚手架

```bash
# 创建项目
npx agentnova create my-agent
cd my-agent
pnpm install

# 添加自定义工具
npx agentnova add-tool slack.notify

# 添加技能
npx agentnova add-skill code-review

# 运行
pnpm dev "帮我看看有哪些文件"
```

---

## 设计哲学

1. **渐进式复杂度**：`quickAgent` → `createAgent` → 深度配置，每一步都能跑
2. **零惊吓默认值**：权限默认 `ask` 模式，不会悄悄执行危险操作
3. **中文友好**：token 估算对 CJK 做了特殊处理，不会低估中文消耗
4. **生产就绪**：结构化错误、全链路追踪、文件日志轮转——不是为了秀技术，是为了半夜被叫醒时能看到为什么挂了
5. **部署无障碍**：sql.js 替代 better-sqlite3，Docker / ARM / Serverless 全兼容

---

## 技术栈

| 层面 | 选型 |
|------|------|
| 语言 | TypeScript 5.8+ (strict) |
| 运行时 | Node.js 22+ |
| LLM SDK | Vercel AI SDK (`ai` + `@ai-sdk/*`) |
| 参数校验 | Zod |
| 构建 | tsup (ESM + CJS + DTS) |
| 包管理 | pnpm workspaces |
| 持久化 | sql.js (WASM SQLite) + JSON 文件 |
| 测试 | Vitest |

---

## 测试覆盖

| 模块 | 测试数 | 状态 |
|------|--------|------|
| @agentnova/core | 48 | ✅ |
| @agentnova/permission | 13 | ✅ |
| @agentnova/memory | 22 | ✅ |
| @agentnova/tools | 7 | ✅ |
| @agentnova/providers | 1 | ✅ |
| @agentnova/skills | 1 | ✅ |
| agentnova | 1 | ✅ |
| **合计** | **93** | ✅ |

### Agent 主循环集成测试（核心心脏）

| 测试 | 验证点 |
|------|--------|
| 正常单步结束 | text/steps/usage 正确 |
| 多步工具调用 | 2 steps、toolCalls 拼接 |
| Provider 降级 | 主失败→fallback 自动切换 |
| 上下文压缩触发 | 小窗口不崩，压缩后正常 |
| 资源限制终止 | maxSteps=3 精确停止 |
| AbortSignal 取消 | 50ms cancel 平滑停止 |
| 钩子拦截 | onBeforeToolCall deny 不崩 |
| 错误恢复 | 工具失败后 Agent 继续运行 |
| 会话隔离 | 连续 run() 无残留 |

---

## 版本

**v0.1.0** — MVP 完成，生产级基础设施到位

---

## License

MIT
