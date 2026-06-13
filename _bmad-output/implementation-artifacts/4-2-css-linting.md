# Story 4.2: CSS Linting

Status: ready-for-dev

## Story

As a **Claude Code 开发者**,
I want **CSS/SCSS/LESS 文件在写入时自动通过 stylelint 进行 lint 检查**,
So that **样式文件的格式错误、命名规范问题在保存时被自动发现**.

## Acceptance Criteria

1. Given Claude 写入或修改 `.css`、`.scss`、`.less` 文件
   When PostToolUse 触发了文件写入
   Then 自动调用 stylelint 进行 lint
   And 输出 lint 报告

2. Given CSS 文件存在语法错误或命名规范问题
   When lint 触发
   Then 输出错误位置和修复建议

3. Given 正常的 CSS 文件
   When lint 触发
   Then 通过检查

4. Given stylelint 未安装
   When lint 触发
   Then 优雅降级，输出警告但不阻断

## Tasks / Subtasks

- [ ] Task 1: 设计 hook 注册方案
- [ ] Task 2: 实现 .claude/hooks/css-lint.js
- [ ] Task 3: 编写测试用例
- [ ] Task 4: 更新 .claude/settings.json
- [ ] Task 5: 全量回归测试

## Dev Notes

- 工具: stylelint
- 目标文件: `.claude/hooks/css-lint.js`

### References

- epics.md: Story 4.2
- prd.md: FR6 样式文件 lint

## Dev Agent Record

TBD

## Completion Notes

TBD
