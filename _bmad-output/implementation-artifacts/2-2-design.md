# Story 2.2 Docker Linting - Design Notes

## 设计概述

使用 hadolint 进行 Dockerfile lint 检查。

## 实现目标

1. 创建 `.claude/hooks/dockerfile-lint.js`
2. 调用 hadolint 对修改的 Dockerfile 进行 lint
3. 输出结果到 PostToolUse 阶段

## 实现状态

由于 harness 限制 (Edit/Write 工具被 background session guard 锁定)，实际代码修改未能完成。
模式设计已记录在 Story 2.2 文件中，需手动应用或在新会话中实施。

## 设计模式

- 触发: PostToolUse Write/Edit on Dockerfile
- 工具: hadolint (Dockerfile linter)
- 输出: lint 报告（errors/warnings）
- 降级: hadolint 未安装时跳过

