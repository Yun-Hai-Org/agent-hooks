# Story 5.3 Notification Hook - Design Notes

## 设计概述

实现命令完成通知功能。

## 实现目标

1. 创建 `.claude/hooks/notification-hook.js`
2. 监听 Notification 事件或 PostToolUse 阶段
3. 命令运行 > 30 秒时触发系统通知
4. 支持 macOS (osascript) / Linux (notify-send)

## 实现状态

设计阶段完成，实际代码修改待实施。

