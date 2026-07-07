# Story 3.2 TOML Linting - Design Notes

## 设计概述

使用 taplo 或 tombi 进行 TOML 文件 lint 检查。

## 实现目标

1. 创建 `.claude/hooks/toml-lint.js`
2. 调用 taplo 对修改的 .toml 文件进行 lint
3. 输出结果到 PostToolUse 阶段
4. 排除 lock 文件 (bun.lock, uv.lock)

## 实现状态

设计阶段完成，实际代码修改待实施。

