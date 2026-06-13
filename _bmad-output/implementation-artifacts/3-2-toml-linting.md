# Story 3.2: TOML Linting

Status: ready-for-dev

## Story

As a **Claude Code 开发者**,
I want **TOML 配置文件 (pyproject.toml、bun.lock、uv.lock 等) 在写入时自动通过 taplo/tombi 进行 lint 检查**,
So that **项目配置文件的格式错误、schema 不一致等问题在保存时被自动发现**.

## Acceptance Criteria

1. Given Claude 写入或修改 `.toml` 文件 (例如 pyproject.toml)
   When PostToolUse 触发了文件写入
   Then 自动调用 taplo 或 tombi 进行 lint
   And 输出 lint 报告 (errors/warnings)

2. Given TOML 文件存在 schema 错误
   When lint 触发
   Then 输出错误位置和修复建议
   And 如果有 errors 则提示用户

3. Given 正常的 pyproject.toml 文件
   When lint 触发
   Then 通过检查，不输出噪音

4. Given bun.lock 或 uv.lock 文件被修改
   When PostToolUse 触发
   Then 跳过 lint (lock 文件不应被修改)

5. Given lint 工具 (taplo) 未安装
   When lint 触发
   Then 优雅降级，输出警告但不阻断

## Tasks / Subtasks

- [ ] Task 1: 设计 hook 注册方案 (PreToolUse + PostToolUse)
- [ ] Task 2: 实现 .claude/hooks/toml-lint.js (调用 taplo)
- [ ] Task 3: 编写测试用例 (正例 + 反例)
- [ ] Task 4: 更新 .claude/settings.json 注册 hook
- [ ] Task 5: 全量回归测试确认无破坏

## Dev Notes

- 目标文件: `.claude/hooks/toml-lint.js`
- 测试文件: `.claude/hooks/__tests__/toml-lint.test.js`
- 工具: taplo (Rust TOML linter) 或 tombi (Python TOML 工具)
- 共享模块: security-orchestrator.js

### References

- epics.md: Story 3.2 定义
- prd.md: FR6 配置文件 lint
- architecture.md: hook 注册机制

## Dev Agent Record

TBD

## Completion Notes

TBD
