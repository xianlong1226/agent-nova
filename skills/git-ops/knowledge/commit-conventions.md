# Commit 规范

## Conventional Commits（默认）

格式：`type(scope): description`

### 类型
| 类型 | 说明 | 示例 |
|------|------|------|
| feat | 新功能 | feat(auth): add OAuth2 login |
| fix | Bug 修复 | fix(api): handle null response |
| refactor | 重构 | refactor(utils): extract helper |
| docs | 文档 | docs: update API reference |
| test | 测试 | test(auth): add login tests |
| chore | 构建/工具 | chore: upgrade to Node 20 |
| perf | 性能 | perf(query): add index |
| ci | CI/CD | ci: add GitHub Actions |

### 规则
1. 描述用祈使句（"add" 而非 "added"）
2. 首行不超过 72 字符
3. Body 说明"为什么"而非"是什么"
4. Breaking Change 用 `!` 标记：`feat(api)!: change response format`
5. 关联 Issue：`fix(api): resolve #123`

### 完整示例
```
feat(auth): add JWT refresh token support

Implement automatic token refresh 5 minutes before expiry.
This prevents users from being logged out during active sessions.

Closes #456
```

## Gitmoji 风格（可选）
```
✨ add JWT refresh token support
🐛 fix null pointer in API handler
♻️ refactor auth middleware
📝 update API documentation
```
