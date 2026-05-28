# 分支管理策略

## 主流策略

### Git Flow
- `main`: 生产代码
- `develop`: 开发集成分支
- `feature/*`: 功能分支
- `hotfix/*`: 紧急修复
- `release/*`: 发布准备

适用：版本发布的传统项目

### GitHub Flow（推荐轻量方案）
- `main`: 可部署分支
- `feature/*`: 功能分支，完成后 PR 合并

适用：持续部署的 Web 项目

### Trunk-Based Development
- `main`: 唯一长期分支
- 短生命周期 feature flag 分支

适用：高频部署、强 CI/CD 团队

## 分支命名规范
```
feat/JIRA-123-add-login
fix/JIRA-456-null-pointer
refactor/JIRA-789-simplify-auth
docs/update-readme
chore/upgrade-deps
```

## 合并策略
- 优先 `rebase` 保持线性历史
- 冲突多时用 `merge` 保留完整记录
- 禁止 `merge commit` 到 main（用 squash merge）
