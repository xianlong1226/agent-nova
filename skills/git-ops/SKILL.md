# Git Operations Skill

## 能力
安全地执行 Git 操作：提交、分支管理、合并、创建 PR。

## 何时使用
- 用户要求 git 操作（commit、branch、merge、PR）
- 输入包含 "git"、"提交"、"分支"、"PR"、"合并" 等关键词

## 安全规则（铁律！）
1. **强制推送前必须确认**：`git push --force` 会覆盖远程历史，必须明确告知用户风险并获得确认
2. **推送主分支前必须确认**：推送到 main/master 前确认用户意图
3. **删除分支前确认**：删除本地或远程分支前确认
4. **重新变基前确认**：`git rebase` 可能改写历史，需确认
5. **不自动推送**：所有 push 操作默认需确认

## 工作流程

### 提交代码
1. 检查 `git status` 了解当前变更
2. 检查 `git diff --staged` 确认暂存区内容
3. 根据变更自动生成 commit message（遵循 conventional commits）
4. 展示 message 给用户确认
5. 执行 `git commit`
6. **不自动 push**，询问用户是否推送

### 创建分支
1. 检查当前分支和工作区状态
2. 如有未提交变更，询问用户是否暂存（stash）
3. 创建并切换到新分支
4. 确认分支命名规范

### 创建 PR
1. 确认当前分支已推送到远程
2. 收集 PR 信息（标题、描述、reviewer）
3. 使用 `gh pr create` 或 GitLab API 创建
4. 返回 PR 链接

### 合并代码
1. 检查目标分支和源分支状态
2. 执行合并（优先 rebase 保持线性历史）
3. 处理冲突（如有）
4. 确认推送

## Commit Message 规范
遵循 Conventional Commits：
```
type(scope): description

[可选 body]
[可选 footer]
```

类型：
- `feat`: 新功能
- `fix`: 修复 bug
- `refactor`: 重构（不改变功能）
- `docs`: 文档变更
- `test`: 测试相关
- `chore`: 构建/工具变更
- `perf`: 性能优化
- `ci`: CI 配置变更

## 配置项
- `commitStyle`: `"conventional"` | `"angular"` | `"gitmoji"` — 提交风格
- `branchPrefix`: `string` — 默认分支前缀
