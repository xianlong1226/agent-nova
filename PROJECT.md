# AgentNova 项目维护指南

> 面向贡献者与维护者：仓库结构、开发流程、调试方法。
>
> 想要使用 SDK 请看 [README.md](./README.md)；深度架构请看 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 项目概述

AgentNova 是 TypeScript 原生的 Agent 开发框架，按职责拆分为 7 个 workspace 包，使用 pnpm + Turbo 管理 monorepo，tsup 产出 ESM + CJS + DTS 三套构建产物，Vitest 做测试。

## 仓库结构

```
agent-nova/
├── packages/                # 7 个 workspace 包（见下文「包职责」）
│   ├── core/                # Agent 核心：主循环、上下文、追踪
│   ├── tools/               # 工具注册与执行
│   ├── permission/          # 权限沙箱与审批
│   ├── memory/              # 三层记忆（sql.js）
│   ├── providers/           # Provider 路由与流控
│   ├── skills/              # 技能加载与发布
│   └── agentnova/           # 统一入口 + CLI
├── examples/                # 6 个可独立运行的示例（独立 workspace）
├── skills/                  # 内置 / 示例技能（code-review, git-ops）
├── docs/
│   ├── API.md               # API 参考
│   └── GUIDE.md             # 使用教程
├── ARCHITECTURE.md          # 架构设计（深度）
├── PROJECT.md               # 本文档
├── README.md                # 使用者入口
├── package.json             # 根 workspace 配置
├── pnpm-workspace.yaml      # workspace 范围：packages/* + examples/*
├── turbo.json               # turbo 任务编排
└── tsconfig.base.json       # TS 共享基础配置
```

## 包职责

| 包名 | 职责 | 主要导出 |
|------|------|---------|
| [@agentnova/contracts](./packages/contracts) | 共享类型契约（零运行时依赖），权限/工具/沙箱/限额相关类型与默认常量 | `PermissionLevel`、`PermissionConfig`、`ToolPermission`、`ApprovalRequest`、`SandboxConfig`、`ResourceLimits`、`ToolPreflight`、`DEFAULT_LIMITS`、`DEFAULT_SANDBOX`、`LEVEL_DEFAULT_MODE` |
| [@agentnova/core](./packages/core) | Agent 主循环、上下文管理、会话、追踪、错误体系 | `Agent`、`ContextManager`、`SessionManager`、`UsageTracker`、`TraceCollector`、`StructuredLogger`、`AgentError` |
| [@agentnova/tools](./packages/tools) | 工具注册、执行引擎、内置 fs/shell 工具（含沙箱 preflight 钩子） | `ToolRegistry`、`ToolEngine`、`defineTool`、`fsTools`、`shellTools` |
| [@agentnova/permission](./packages/permission) | 权限决策（mode/rules/审批回调）、sandbox 配置容器；沙箱前置校验由各工具的 `preflight` 实现 | `PermissionGuard`、`DEFAULT_PERMISSION_CONFIG` |
| [@agentnova/memory](./packages/memory) | 三层记忆 + 语义注入 + 重要性衰减 | `WorkingMemory`、`ProjectMemory`、`LongTermMemory`、`MemoryInjector` |
| [@agentnova/providers](./packages/providers) | Provider 路由、降级链、限流 | `createRouter`、`createOpenAICompatibleProvider`、`RateLimiter`、`ProviderRouter` |
| [@agentnova/skills](./packages/skills) | 技能加载、注册、运行时激活、发布 | `SkillLoader`、`SkillRegistry`、`SkillLoaderWorker` |
| [agentnova](./packages/agentnova) | 统一入口（重新导出所有子包）+ CLI + `quickAgent` | `Agent`、`quickAgent`、`createRouter`、CLI 二进制 |

各模块的内部架构与设计决策见 [ARCHITECTURE.md](./ARCHITECTURE.md) 第二～十章。

## 依赖关系

```
agentnova ──→ core ──→ tools / permission / memory / providers / skills
                       │       │
                       └───────┴──→ contracts (共享类型契约)
              │
              └──→ (Vercel AI SDK: ai + @ai-sdk/*)
```

子包之间零循环依赖。`@agentnova/contracts` 作为类型契约源单点，承载权限/工具/沙箱共享类型，其它包通过转发的方式对外保持原有 API。

## 技术栈

| 层面 | 选型 |
|------|------|
| 语言 | TypeScript 5.8+（strict） |
| 运行时 | Node.js 22+ |
| LLM SDK | Vercel AI SDK（`ai` + `@ai-sdk/*`） |
| 参数校验 | Zod |
| 构建 | tsup（ESM + CJS + DTS） |
| 包管理 | pnpm workspaces |
| 任务编排 | Turbo |
| 持久化 | sql.js（WASM SQLite）+ JSON 文件 |
| 测试 | Vitest |

## 环境要求与初始化

```bash
# Node 22+ / pnpm 9+
node -v
pnpm -v

# 安装依赖（含 examples）
pnpm install

# 全量构建
pnpm build
```

## 常用命令

| 命令 | 行为 | 备注 |
|------|------|------|
| `pnpm build` | `turbo run build` | 拓扑构建所有包，产物落到各包 `dist/` |
| `pnpm dev` | `turbo run dev` | 持久化 watch（`persistent: true`），上游构建完成后启动 |
| `pnpm test` | `turbo run test` | 依赖 `build`，跑各包 `vitest run` |
| `pnpm lint` | `turbo run lint` | |
| `pnpm clean` | `turbo run clean` | 清理 `dist/` |

`turbo.json` 中关键约定：

- `build.dependsOn: ["^build"]` —— 拓扑顺序构建，下游包必须等上游就绪
- `dev` 不缓存且 `persistent`，确保 watch 模式不被 Turbo 提前结束
- `test.dependsOn: ["build"]` —— 测试先确保产物存在

## 包级开发

单包开发更快：

```bash
cd packages/core
pnpm build       # 一次构建
pnpm dev         # tsup --watch
pnpm test        # vitest run
pnpm clean       # rm -rf dist
```

每个包都遵循相同的清单：

- `package.json` 中导出 `dist/index.js` (ESM) / `dist/index.cjs` (CJS) / `dist/index.d.ts`
- `tsup.config.ts` 中 `format: ['esm', 'cjs']` + `dts: true`，外部依赖（如 `ai`）放进 `external`
- `tsconfig.json` 继承 `tsconfig.base.json`
- `test/` 目录放 Vitest 测试文件

新增包时记得：

1. 加入 `pnpm-workspace.yaml`（已通配 `packages/*`）
2. 在依赖它的包 `package.json` 中以 `workspace:*` 引用
3. 如果有非默认任务，需要在 `turbo.json` 加入对应 pipeline

## examples 工作流

`examples/` 是 monorepo 的一部分（见 [pnpm-workspace.yaml](./pnpm-workspace.yaml)），通过 `workspace:*` 引用 `agentnova`：

```jsonc
// examples/01-basic/package.json
{
  "dependencies": { "agentnova": "workspace:*" }
}
```

工作流要点：

- **首次运行前必须 `pnpm build`**：examples 直接 import 从子包 `dist/` 出来的产物
- 修改 `packages/` 后，要么再 `pnpm build`，要么开 `pnpm dev` 让 tsup 持续 watch
- 运行示例：

  ```bash
  cd examples/01-basic
  LLM_BASE_URL=https://api.deepseek.com/v1 \
  LLM_API_KEY=sk-xxx \
  LLM_MODEL=deepseek-chat \
    pnpm start
  ```

## 调试方法

### VS Code 调试

仓库自带 [.vscode/launch.json](./.vscode/launch.json) 的 "Debug Current Example" 配置：

1. 打开任意 `examples/*/index.ts`
2. 在终端 `export DEEPSEEK_API_KEY=...`（或 `OPENAI_API_KEY` / `OPENAI_BASE_URL`）
3. 按 `F5` 启动调试

启动器会用 `node_modules/.bin/tsx --conditions node` 直接跑当前文件，断点、变量查看、调用栈都可用。

### tsx 直跑

```bash
pnpm tsx examples/01-basic/index.ts
pnpm tsx packages/agentnova/src/cli.ts run "你好"
```

### CLI 调试

CLI 入口在 [packages/agentnova/src/cli.ts](./packages/agentnova/src/cli.ts)：

```bash
# 直接跑源码
pnpm tsx packages/agentnova/src/cli.ts <args>

# 链接到全局后用真实命令名调试
cd packages/agentnova && pnpm link --global
agentnova create my-agent
```

## 测试

| 范围 | 命令 |
|------|------|
| 整库 | `pnpm test`（先 `build` 后 `vitest`） |
| 单包 | `cd packages/<name> && pnpm test` |
| 单文件 | `cd packages/<name> && pnpm vitest run test/some.test.ts` |

测试目录约定：`packages/<name>/test/*.test.ts`。当前覆盖：

| 模块 | 测试数 |
|------|-------|
| @agentnova/core | 52+ |
| @agentnova/permission | 13 |
| @agentnova/memory | 22 |
| @agentnova/tools | 7 |
| @agentnova/providers | 1 |
| @agentnova/skills | 1 |
| agentnova | 1 |

Agent 主循环集成测试覆盖：单步结束、多步工具调用、Provider 降级、上下文压缩、资源限制、AbortSignal 取消、钩子拦截、错误恢复、会话隔离。详见 [packages/core/test/](./packages/core/test/)。

## 发布与版本

本项目使用 [Changesets](https://github.com/changesets/changesets) 管理多包版本与发布流程。

### 前置要求

- 已通过 `npm login` 登录有 `@agentnova` scope 发布权限的 npm 账号
- 确保 npm registry 上已创建 `@agentnova` org（首次发布前）

### 工具安装

Changesets CLI 已配置在根 `devDependencies`，执行 `pnpm install` 即可使用。

### 版本策略

- 所有包使用 **linked** 策略联动版本（`agentnova` + `@agentnova/*`）
- 内部依赖（`workspace:*`）发布时自动替换为真实版本号
- 默认 `access: public`，scoped 包可直接发布到公共 registry

### 发布流程

```bash
# 1. 记录变更（交互式选择受影响的包和版本升级类型 patch/minor/major）
pnpm changeset

# 2. 消费 changeset，自动更新各包 version 和生成 CHANGELOG.md
pnpm version-packages

# 3. 检查产物：确认 package.json 版本号已更新、CHANGELOG 内容正确
git diff

# 4. 提交版本变更
git add .
git commit -m "chore: version packages"

# 5. 构建并发布到 npm
pnpm release
# 等价于 pnpm build && changeset publish

# 6. 打 tag 并推送
git push --follow-tags
```

### 发布前 Checklist

| # | 检查项 | 命令 |
|---|--------|------|
| 1 | 依赖干净 | `pnpm clean && pnpm install` |
| 2 | 构建通过 | `pnpm build` |
| 3 | 测试全绿 | `pnpm test` |
| 4 | changeset 已消费 | `pnpm version-packages`（无未消费的 changeset） |
| 5 | 版本号正确 | 检查各包 `package.json` 中 `version` 字段 |
| 6 | Git 工作区干净 | `git status` 无未提交改动 |

### 手动发布单包（调试用）

```bash
cd packages/core
pnpm build
npm publish --access public
```

### 常用命令速查

| 命令 | 作用 |
|------|------|
| `pnpm changeset` | 添加一个 changeset（记录本次改动涉及哪些包、bump 类型、变更描述） |
| `pnpm version-packages` | 消费所有 changeset → 更新 version + 生成 CHANGELOG |
| `pnpm release` | 构建全部包 → 发布到 npm registry |
| `pnpm changeset status` | 查看当前未消费的 changeset |

### 配置文件

- **`.changeset/config.json`** — Changesets 核心配置（linked 策略、access、baseBranch 等）
- 各包 `package.json` 中 `publishConfig.access: "public"` 确保 scoped 包可公开发布
- `files: ["dist"]` 确保仅发布构建产物，不包含源码和测试

### 关于 `workspace:*` 协议

pnpm publish / changeset publish 会在发布时自动将 `workspace:*` 替换为对应包的实际版本号（如 `^0.1.0`），用户通过 npm 安装后能正确解析依赖关系，无需手动修改。

技能（Skill）发布渠道（Git / npm / dry-run）见 [ARCHITECTURE.md 第十章](./ARCHITECTURE.md)。

## 常见维护问题

| 问题 | 解决思路 |
|------|---------|
| `dev` watch 下首次构建报 DTS 错误 | tsup DTS 时序问题：先 `pnpm build` 一次让 `dist/` 就绪，再开 `dev` |
| `.gitignore` 改了不生效 | 已被跟踪的文件需要 `git rm --cached <path>` 后再提交 |
| 智谱 GLM 等 OpenAI 兼容端点报错 | `assistant.content` 不能为 `null`、`temperature` 不能为 `0`，已在 core 层做规范化 |
| `pnpm install` 报版本不存在 | 检查根 / 子包 `package.json` 中的 `workspace:*` 是否拼写正确，必要时清掉 `node_modules` 重装 |
| examples 看不到代码改动 | examples 引用的是子包 `dist/`，改完源码后必须重建（`pnpm build` 或开着 `pnpm dev`） |

## License

MIT
