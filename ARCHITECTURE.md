# AgentNova SDK 架构设计文档 🔮

## 一、总体架构

```
┌─────────────────────────────────────────────────────────┐
│                     AgentNova CLI                       │
│               create / add-tool / run / skill            │
├─────────────────────────────────────────────────────────┤
│                   agentnova (统一入口)                    │
│           重新导出 + quickAgent + 类型导出               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │              @agentnova/core                       │  │
│  │                                                    │  │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │  │
│  │  │  Agent   │←→│ Context  │←→│   Memory      │   │  │
│  │  │ (主循环)  │  │ Manager  │  │   Injector    │   │  │
│  │  └────┬─────┘  └────┬─────┘  └───────┬───────┘   │  │
│  │       │              │                 │           │  │
│  │  ┌────▼─────┐  ┌────▼─────┐  ┌───────▼───────┐   │  │
│  │  │  Usage   │  │  Trace   │  │    Logger     │   │  │
│  │  │ Tracker  │  │ Collector│  │ (Structured)  │   │  │
│  │  └──────────┘  └──────────┘  └───────────────┘   │  │
│  │                                                    │  │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │  │
│  │  │ Session  │  │  Agent   │  │    Skill      │   │  │
│  │  │ Manager  │  │  Error   │  │    Worker     │   │  │
│  │  └──────────┘  └──────────┘  └───────────────┘   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │@agentnova/   │  │@agentnova/   │  │@agentnova/   │  │
│  │  tools       │  │  permission  │  │  memory      │  │
│  │              │  │              │  │              │  │
│  │ Registry     │  │ Guard        │  │ Working      │  │
│  │ Engine       │  │ (mode/rules) │  │ Project      │  │
│  │ Built-in     │  │ Sandbox cfg  │  │ LongTerm     │  │
│  │  fs/shell    │  │ Approval     │  │  (sql.js)    │  │
│  │ + preflight  │  │  callback    │  │              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  │
│         │                 │                            │
│         └─────────┬───────┘                            │
│                   ▼                                    │
│         ┌─────────────────────┐                        │
│         │ @agentnova/contracts│                        │
│         │  共享类型契约       │                        │
│         │  (零运行时依赖)     │                        │
│         └─────────────────────┘                        │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │@agentnova/   │  │@agentnova/   │                     │
│  │  providers   │  │  skills      │                     │
│  │              │  │              │                     │
│  │ Router       │  │ Loader       │                     │
│  │ Fallback     │  │ Registry     │                     │
│  │ RateLimiter  │  │ Market       │                     │
│  │  Presets     │  │  publish     │                     │
│  └──────────────┘  └──────────────┘                     │
└─────────────────────────────────────────────────────────┘
           │                    │
           ▼                    ▼
    ┌──────────────┐    ┌──────────────┐
    │  Vercel AI   │    │  File System │
    │    SDK       │    │  + sql.js    │
    │ (ai + adapters)│    │              │
    └──────────────┘    └──────────────┘
```

### 依赖关系

```
contracts ← tools, permission, memory, providers, core
core → tools, permission, memory, providers
agentnova → core → (所有子包)
```

子包之间**零循环依赖**。共享类型（权限、工具、沙箱、限额）统一在 `@agentnova/contracts` 中声明，其它包通过 `import type` 引用并 re-export 转发，确保单一源真理。

---

## 二、Agent 主循环（核心心脏）

### 执行流程

```
run(prompt)
  │
  ├─ resetState()       // 重置上下文、状态、步骤
  ├─ emit('agent:start')
  ├─ runHook('onStart')
  │
  └─ while (step < maxSteps)
       │
       ├─ 检查 abortSignal / state.aborted ──────→ break
       ├─ usage.isLimitExceeded() ──────────────→ break
       │
       ├─ injectMemories(prompt)
       │    └─ MemoryInjector 按 token 预算注入
       │
       ├─ needsCompression(messages)?
       │    └─ compressWithMeta() → 替换 messages
       │
       ├─ executeStep()
       │    ├─ buildAITools()      // 注册所有工具到 AI SDK
       │    ├─ runHook('onBeforeLLMCall')
       │    ├─ 遍历 fallbackChain:
       │    │    ├─ generateText(model, messages, tools)
       │    │    ├─ 成功 → 解析 response
       │    │    └─ 失败 + shouldFallback → 下一个 Provider
       │    ├─ runHook('onAfterLLMCall')
       │    ├─ 记录 usage（inputTokens + outputTokens）
       │    ├─ 构建 StepInfo（text、toolCalls、toolResults）
       │    ├─ 同步 messages（从 SDK response 重建）
       │    └─ return hasToolCalls  // 决定是否继续循环
       │
       └─ !shouldContinue? ──→ break

  return buildResult()
       ├─ extractFinalText()  // 最后一条 assistant 消息
       ├─ runHook('onEnd')
       └─ emit('agent:end')
```

### 关键设计决策

**1. SDK 消息同步策略**

AI SDK 的 `generateText()` 返回完整的 `response.messages`，我们用它重建自己的消息列表，而非手动拼装。这样确保工具调用/结果的格式与 SDK 内部理解完全一致，避免格式不匹配导致的幻觉或工具调用失败。

**2. 工具执行委托**

`buildAITools()` 给每个工具创建 AI SDK `Tool` 对象，其 `execute` 函数委托给 `Agent.executeToolCall()`。这意味着工具执行经过完整的权限检查 + 钩子拦截 + 上下文截断管线，而不是绕过后直接跑。

**3. 流式执行双路径**

`runStream()` 与 `run()` 共享同一个循环结构，只在 "获取 LLM 响应" 这一步换成 `streamText()` + 逐块吐出文本。工具调用逻辑完全一致。

---

## 三、上下文管理

### Token 预算模型

```
┌──────────────────────────────────────────────────────┐
│                  Context Window                       │
│  ┌────────────────────────────────────────────────┐  │
│  │              Usable (80%)                       │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │         Consumed                         │  │  │
│  │  ├──────────────────────────────────────────┤  │  │
│  │  │   Remaining = Usable - Consumed - Reserve│  │  │
│  │  │                                          │  │  │
│  │  │   Memory Budget (from Remaining)         │  │  │
│  │  │   Tool Output (≤40% of Remaining)       │  │  │
│  │  │   Response Reserve (30% of Remaining)   │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 压缩策略

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| `sliding-window` | 保留最近 N 轮，丢弃更早的 | 快速但不保留历史 |
| `summary` | LLM 自动摘要旧消息（带代词消解提示词） | 需要上下文连续性 |
| `hybrid` | 先尝试 LLM 摘要，失败则退化为语义提取 | 生产默认选择 |

### 语义优先级评分

消息不再只按 role 排优先级，而是根据语义内容动态评分：

| 信号 | 加分 | 原因 |
|------|------|------|
| 包含错误/失败信息 | +25 | Agent 最常犯的错是重复已知失败的操作 |
| 包含用户偏好/决策 | +20 | 用户明确说的比 Agent 推测的更重要 |
| 包含代词引用 | +15 | "that"、"it" 需要保留上下文才能消解 |
| Assistant 长推理 | +10 | 推理过程丢失会导致后续步骤错误 |
| 数值/路径/配置 | +10 | 这些信息几乎不可能从上下文重建 |

### 主动压缩

不只等到超阈值才压缩。`compressAfterToolCall()` 在每次大的工具输出后检查：如果当前消耗 + 工具输出 > 85% 可用阈值，立即压缩。这避免了 "刚好超了一点" 时被动压缩导致的卡顿。

### 自适应窗口

`adaptToProvider()` 根据 Provider 的实际窗口大小调整策略：
- ≤32K：保留 5 轮，50% 触发
- ≤128K：保留 10 轮，70% 触发  
- >128K：保留 15 轮，75% 触发

---

## 四、记忆系统

### 三层架构

```
┌─────────────────────────────────────────────┐
│  Layer 1: WorkingMemory                     │
│  存储: 内存 Map                              │
│  生命周期: 单次 run()                        │
│  特点: 最快、易失、无衰减                     │
│  适合: 当前任务的中间状态                     │
├─────────────────────────────────────────────┤
│  Layer 2: ProjectMemory                     │
│  存储: AGENT.md 文件                         │
│  生命周期: 项目级持久化                       │
│  特点: 人工可读可编辑、版本控制友好           │
│  适合: 项目约定、团队偏好、长期决策           │
├─────────────────────────────────────────────┤
│  Layer 3: LongTermMemory                    │
│  存储: sql.js (WASM SQLite)                 │
│  生命周期: 永久，直到衰减淘汰                 │
│  特点: 语义搜索、重要性衰减、主动淘汰         │
│  适合: 跨项目经验、错误解决方案、用户画像     │
└─────────────────────────────────────────────┘
```

### 重要性衰减

```
score = base × 0.5 ^ (age_hours / halflife)

| 级别     | base | 半衰期  | 示例                     |
|----------|------|---------|--------------------------|
| critical | 1.0  | ∞       | 用户偏好、核心身份、红线 |
| high     | 0.8  | 30 天   | 架构决策、错误修复方案   |
| normal   | 0.5  | 7 天    | 当前任务上下文           |
| low      | 0.2  | 1 天    | 临时观察、中间结果       |
```

### 自动分类

`classifyImportance()` 通过内容启发式自动判断重要性级别：

- **critical**: 包含"偏好"、"身份"、"红线"、"必须"、"永远不"
- **high**: 包含"决定"、"方案"、"修复"、"架构"、错误关键词
- **low**: 包含"临时"、"随便"、"测试一下"
- **normal**: 其他

### 主动淘汰

当 LongTermMemory 中的记忆条目超过阈值（默认 1000 条），自动清理：
1. 计算每条记忆的衰减分数
2. 分数低于 `EVICT_THRESHOLD`（0.05）的直接删除
3. 仍未达标的，按分数从低到高删除至阈值以下

---

## 五、权限系统

### 决策流程

```
工具调用请求
    │
    ├─ 查 always-allowed 缓存 ──→ hit → allow
    │
    ├─ 查显式规则（支持 * 和 ns.* 通配）
    │   ├─ allow → allow
    │   ├─ deny → deny
    │   └─ ask → 进入审批流程
    │
    ├─ 全局模式检查
    │   ├─ allow → allow
    │   ├─ deny → deny
    │   └─ ask → 按 level 映射
    │
    └─ Level 默认映射
        ├─ read → allow
        ├─ write → ask
        └─ dangerous → ask

审批流程:
    ├─ 有审批回调 → 调用回调
    │   ├─ allow-once → 本次放行
    │   ├─ allow-always → 缓存为 always
    │   └─ deny → 拒绝
    └─ 无回调 → deny
```

### 沙箱检查（preflight 钩子）

沙箱前置校验由各工具自身的 `ToolDefinition.preflight` 钩子实现，`PermissionGuard` 不再硬编码工具名。`Agent.executeToolCall` 在调用 `guard.check(req, toolDef.preflight)` 时把 `preflight` 作为第二参下传，`PermissionGuard` 负责把当前 `sandbox` 配置注入回调上下文。

```typescript
export type PreflightResult = { ok: true } | { ok: false; reason: string }
export interface ToolPreflightCtx { sandbox: SandboxConfig }
export type ToolPreflight = (req: ApprovalRequest, ctx: ToolPreflightCtx) => PreflightResult
```

内置工具自带的 preflight：

| 工具 | preflight | 规则 |
|------|-----------|------|
| `fs.readFile` / `fs.listDir` / `fs.stat` | `pathPreflight` | 路径必须落在 `sandbox.allowedDirs` 内 |
| `fs.writeFile` | `composePreflights(pathPreflight, sizePreflight)` | 路径白名单 + `args.content` 长度 ≤ `sandbox.maxFileSize` |
| `shell.exec` | `commandPreflight` | 命令不在 `blockedCommands` 与 `blockedCommandPatterns` 中 |

第三方工具如需沙箱拦截，自行在 `defineTool` 时实现 `preflight` 即可，不再需要改动 permission 包。

### 默认规则

```typescript
// contracts/DEFAULT_PERMISSION_CONFIG
{
  mode: 'ask',
  rules: [],            // 空规则 → 完全由 LEVEL_DEFAULT_MODE 兜底
  sandbox: DEFAULT_SANDBOX,
  limits: DEFAULT_LIMITS,
}

// LEVEL_DEFAULT_MODE 兜底
read      → allow
write     → ask
dangerous → ask
```

用户可通过 `rules` 覆写：例如 `{ tool: 'fs.writeFile', mode: 'allow' }` 把写文件改为自动放行；通配符 `'fs.*'` / `'*'` 也支持。

### 注册期 Lint（D 方案）

`Agent` 构造期会调用 `lintPermissions()` 静态校验：

- `rules` 引用了未注册工具 → `logger.warn('[permission] rule references unknown tool', ...)`
- `dangerous` 工具被某条 rule 设为 `allow` → `logger.warn('[permission] dangerous tool unconditionally allowed by rule', ...)`
- `read` 工具被某条 rule 设为 `deny` → `logger.warn('[permission] read-only tool denied by rule', ...)`

Lint 不抛错，仅写日志；通配符规则不参与第一条检查。

---

## 六、Provider 路由

### 降级链

```
请求 → Default Provider
         │
         ├─ 成功 → 返回
         │
         └─ 失败 → shouldFallback(err)?
                     │
                     ├─ 是 → Fallback #1
                     │        ├─ 成功 → 返回
                     │        └─ 失败 → Fallback #2 → ...
                     │
                     └─ 否 → 抛出异常（认证错误不降级）
```

### 速率限制

```
┌────────────────────────────────────────────────┐
│               RateLimiter                       │
│                                                 │
│  Global Call Bucket ──┐                         │
│  Global Token Bucket ─┤→ acquire(provider, tokens) │
│  Provider Call Bucket ┤   → 等待所有桶有配额     │
│  Provider Token Bucket┘   → 消耗所有桶           │
│                                                 │
│  429 响应 → reportRateLimited(provider)         │
│            → 自动 backoff (2x, max 60s)         │
│                                                 │
│  成功响应 → reportSuccess(provider)             │
│            → 清除 backoff                       │
└────────────────────────────────────────────────┘
```

六个独立的令牌桶协同工作：两个全局（调用次数 + token 数）+ 四个按 Provider（每个 Provider 自身的调用次数 + token 数）。`acquire()` 会计算所有桶的等待时间，取最大值等待，然后一次性消耗。

---

## 七、会话管理

### 并发安全模型

```
SessionManager
  │
  ├─ user:alice → Session A (lock queue: [])
  │                 ├─ messages: [...]
  │                 ├─ state: {...}
  │                 └─ running: false
  │
  ├─ user:bob → Session B (lock queue: [])
  │               ├─ messages: [...]
  │               ├─ state: {...}
  │               └─ running: true  ← 正在执行
  │
  └─ user:alice → Session C (lock queue: [fn2])
                    ├─ messages: [...]  ← 独立的消息
                    ├─ state: {...}     ← 独立的状态
                    └─ running: true    ← fn1 正在跑
                           ↑
                      fn2 排队等待 fn1 释放
```

**核心保证**：
- 同一用户的请求串行排队 → 不会数据竞争
- 不同用户的请求完全并行 → 不会互相阻塞
- 每个用户独立的 messages / state / memory → 物理隔离

### 持久化

```
sessions/
  ├─ sess_alice_1716800000.json   ← 完整会话快照
  ├─ sess_bob_1716800050.json
  └─ sess_alice_1716800100.json

每个 JSON:
{
  "sessionId": "sess_alice_1716800000",
  "userId": "alice",
  "messages": [...],           ← 完整对话历史
  "state": { step, tokens, ... },
  "createdAt": 1716800000000,
  "updatedAt": 1716800100000,
  "metadata": {}
}
```

- 自动定时保存（默认 30s）
- `shutdown()` 时全量保存
- 损坏文件抛 `SESSION_CORRUPTION` 结构化错误
- 重启后 `loadAllSessions()` 恢复

---

## 八、结构化错误系统

### 错误码域

```
PROVIDER_*  (7个)  — 网络层和 API 层的错误
TOOL_*      (6个)  — 工具查找、权限、执行错误
MEMORY_*    (3个)  — 存储和损坏错误
CONTEXT_*   (2个)  — 上下文溢出和压缩错误
LIMIT_*     (5个)  — 资源限制错误
SESSION_*   (3个)  — 并发和持久化错误
CONFIG_*    (2个)  — 配置错误
```

### 自动推理

`AgentError.from(unknown)` 会从 Error message 中提取关键词，自动映射到最可能的错误码：

```
"429 rate limit"     → PROVIDER_RATE_LIMIT
"timeout after 30s"  → PROVIDER_TIMEOUT
"permission denied"  → TOOL_PERMISSION_DENIED
"ECONNREFUSED"       → PROVIDER_NETWORK
```

### 重试策略映射

每个错误码硬编码了重试策略：

| 策略 | 适用错误 | 行为 |
|------|---------|------|
| `never` | AUTH / NOT_FOUND / DENIED | 不重试，修配置才能解决 |
| `immediate` | CONTEXT_OVERFLOW | 立即重试（压缩后通常会成功） |
| `backoff` | TIMEOUT / NETWORK / SERVER_ERROR | 1-3s 随机延迟后重试 |
| `after_cooldown` | RATE_LIMIT / QUOTA / CONCURRENT | 30-60s 延迟后重试 |

---

## 九、日志与追踪

### 双轨日志

```
┌─ StructuredLogger ──────────────────────┐
│  内存: logs[] ← 查询和测试用            │
│  文件: filePath ← NDJSON 追加写入       │
│  轮转: size > maxFileSize → rotate      │
│  采样: samplingRate=10 → 只记 1/10      │
│  静默: NODE_ENV=production → 只写文件    │
└─────────────────────────────────────────┘
```

### 追踪管线

```
Agent 执行
  │
  ├─ 每个 step → TraceCollector.record()
  │   ├─ type: step | tool_call | tool_result | llm_call | compression | skill | provider_fallback
  │   └─ data: { step, tool, args, tokens, ... }
  │
  ├─ 执行结束 → TraceCollector.buildTrace()
  │   └─ 返回完整 Trace 快照
  │
  └─ TraceReplay.replay()
      ├─ 逐条回放（支持延迟）
      ├─ summary() → 人类可读摘要
      └─ toJSON() → 机器可读导出
```

### 日志轮转

```
agent.log          ← 当前写入
agent.log.1        ← 上一个
agent.log.2        ← 更早的
agent.log.3        ← 最老的（再老就删）
```

---

## 十、技能系统

### 技能目录结构

```
skills/
  code-review/
    ├── skill.config.json   ← 元数据 + 激活条件
    ├── SKILL.md            ← 注入到 system prompt 的指令
    ├── tools/
    │   └── index.ts        ← 技能专属工具
    └── knowledge/
        └── best-practices.md  ← 知识库文档
```

### 技能配置

```json
{
  "name": "code-review",
  "version": "1.0.0",
  "description": "自动化代码审查",
  "activateOn": "input.includes('review') || input.includes('审查')",
  "prompt": "SKILL.md",
  "tools": [],
  "knowledge": ["best-practices.md"],
  "defaultConfig": {}
}
```

### 运行时激活

1. `SkillLoaderWorker.loadAll(skillDirs)` — 启动时加载所有技能
2. `SkillLoaderWorker.activateForInput(prompt)` — 根据输入匹配激活条件
3. 激活后：注入 SKILL.md 到 system prompt + 注册技能专属工具 + 加载知识库
4. `SkillRegistry` — 管理 install/uninstall/search/publish

### 发布渠道

| 渠道 | 方式 | 命令 |
|------|------|------|
| Git | `git push` 到指定仓库 | `agentnova skill publish code-review --remote git@github.com:org/skills.git` |
| npm | `npm publish` 为 `@agentnova/skill-*` 包 | `agentnova skill publish code-review --registry https://registry.npmjs.org` |
| dry-run | 只检查不推送 | `agentnova skill publish code-review --dry-run` |

---

## 十一、实体关系

```
Agent
 ├──1:1→ ProviderRouter ──→ ProviderConfig[]
 ├──1:1→ ContextManager
 ├──1:1→ UsageTracker
 ├──1:1→ TraceCollector
 ├──1:1→ StructuredLogger
 ├──1:1→ PermissionGuard
 ├──1:1→ ToolRegistry ──→ ToolDefinition[]
 ├──1:1→ ToolEngine
 ├──1:1→ WorkingMemory
 ├──1:1→ ProjectMemory
 ├──0..1→ LongTermMemory (sql.js)
 ├──1:1→ MemoryInjector
 ├──1:1→ SkillLoaderWorker
 ├──0..N→ HookFn[] (per hook name)
 └──0..N→ EventHandler[] (per event name)

SessionManager
 └──0..N→ UserSession (per userId)
           ├── messages: CoreMessage[]
           ├── state: AgentState
           └── runQueue: (() => void)[]
```

---

## 十二、关键接口

```typescript
// 创建 Agent
createAgent(config: AgentConfig): Agent

// 执行
agent.run(prompt: string, options?: AgentRunOptions): Promise<AgentResult>
agent.runStream(prompt: string, options?: AgentRunOptions): Promise<AgentResult>

// 生命周期
agent.hook(name: HookName, fn: HookFn): void
agent.on(event: AgentEventName, handler: EventHandler): void
agent.abort(): void

// 可观测
agent.getState(): Readonly<AgentState>
agent.getUsage(): UsageSnapshot
agent.getTrace(): Trace
agent.getLogger(): StructuredLogger
agent.remember(key: string, content: string, layer?: string): Promise<void>

// 会话
sessionManager.withSession(userId: string, fn: (session) => Promise<T>): Promise<T>
sessionManager.createSession(userId: string): UserSession
sessionManager.shutdown(): Promise<void>
```

---

## 十三、性能考量

| 维度 | 设计 | 数据 |
|------|------|------|
| Token 估算 | CJK 2 chars/token, English 4 chars/token | 中文估算精度提升 ~40% |
| 记忆注入 | 预算感知：余量 <2000 只塞 1 条 | 窗口紧张时不触发额外压缩 |
| 工具输出截断 | 动态：不超过剩余 40% | 避免工具输出撑爆窗口 |
| 主动压缩 | 大输出后检查 85% 阈值 | 减少 50% 的被动压缩卡顿 |
| sql.js 初始化 | 异步 + lazy load | 不阻塞 Agent 创建 |
| 日志写入 | 队列化串行写入 | 无文件竞争 |
| 会话锁 | 排队等待，非忙轮询 | CPU 零开销 |

---

## 十四、扩展点

| 扩展方式 | 代码位置 | 示例 |
|---------|---------|------|
| 自定义工具 | `defineTool({...})` | 数据库查询、Slack 通知 |
| 生命周期钩子 | `agent.hook('onBeforeToolCall', fn)` | 审计日志、限流 |
| 事件监听 | `agent.on('tool:call', handler)` | UI 更新、指标上报 |
| 自定义 Provider | `createOpenAICompatibleProvider({...})` | 私有部署、新模型 |
| 技能包 | `skills/name/skill.config.json` | 代码审查、部署流程 |
| 错误处理 | `AgentError.from(err)` | 结构化上报、重试策略选择 |
| 日志后端 | `StructuredLogger({ filePath })` | ELK 接入、Sentry 上报 |

---

## 十五、已知局限性 & 后续方向

### 当前局限

1. **LongTermMemory 语义搜索**：基于关键词匹配，未接入向量数据库，召回精度有限
2. **流式工具调用**：`runStream()` 支持文本流式，但工具中间状态不可流式
3. **多 Agent 协作**：当前单 Agent 实例，无 Agent 间通信协议
4. **Skills 激活**：基于简单表达式匹配，无 LLM 辅助的意图理解

### 后续方向

| 方向 | 目标 |
|------|------|
| 向量记忆 | 接入 embedding 模型，LongTermMemory 支持真正的语义搜索 |
| 多 Agent | Agent 间消息传递 + 任务委派 |
| 流式工具 | 工具执行中间状态流式上报 |
| 智能激活 | LLM 辅助的技能路由 |
| 分布式会话 | Redis / 外部存储后端 |
| 可视化 | Trace 数据 → 时间线 UI |
