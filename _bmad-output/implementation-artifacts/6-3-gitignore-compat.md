# Story 6.3: Gitignore Compatibility

Status: ready-for-dev

## Story

As a **Claude Code 开发者**,
I want **hooks 兼容 `.gitignore` 排除规则**,
So that **被 git 忽略的文件不会被 hooks 误处理**.

## Acceptance Criteria

1. Given 文件路径在 `.gitignore` 中
   When hooks (PreToolUse/PostToolUse) 触发
   Then 跳过该文件，不做任何处理

2. Given `.gitignore` 包含 `*.log` 模式
   When 写入 `debug.log` 文件
   Then hooks 跳过，不执行 lint/secrets 检查

3. Given `.gitignore` 不存在
   When hooks 触发
   Then 正常处理所有文件

## Tasks / Subtasks

- [ ] Task 1: 设计 gitignore 解析逻辑
- [ ] Task 2: 实现 gitignore 兼容层
- [ ] Task 3: 编写测试用例 (多种 gitignore 模式)
- [ ] Task 4: 更新所有 hooks 集成 gitignore 检查
- [ ] Task 5: 全量回归测试

## Dev Notes

- 工具: ignore 库 (npm) 或自实现 gitignore 解析
- 目标文件: `.claude/hooks/gitignore.js`
- 需要修改: protect-secrets.js, post-write-lint.js 等

### References

- epics.md: Story 6.3
- prd.md: NFR12 gitignore 兼容性

## Dev Agent Record

TBD

## Completion Notes

TBD
