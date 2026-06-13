# Story 5.3: Notification Hook

Status: ready-for-dev

## Story

As a **Claude Code 用户**,
I want **长时间运行的命令完成时收到系统通知**,
So that **我可以切换窗口时知道任务已完成**.

## Acceptance Criteria

1. Given Bash 命令运行超过 30 秒
   When 命令完成
   Then 触发 Notification Hook (PostToolUse 或 Notification 事件)
   And 通过 macOS notification 或 terminal bell 提示用户

2. Given 命令快速完成 (< 30 秒)
   When 命令结束
   Then 不触发通知

3. Given 用户禁用通知
   When 通知本应触发
   Then 跳过通知逻辑

## Tasks / Subtasks

- [ ] Task 1: 设计 notification 触发逻辑
- [ ] Task 2: 实现 .claude/hooks/notification-hook.js
- [ ] Task 3: 编写测试用例
- [ ] Task 4: 更新 .claude/settings.json
- [ ] Task 5: 全量回归测试

## Dev Notes

- 通知方式: osascript (macOS) / notify-send (Linux)
- 目标文件: `.claude/hooks/notification-hook.js`

### References

- epics.md: Story 5.3
- prd.md: FR10 用户通知

## Dev Agent Record

TBD

## Completion Notes

TBD
