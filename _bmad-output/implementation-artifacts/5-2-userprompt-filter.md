# Story 5.2: UserPromptSubmit 敏感词过滤钩子

Status: done

## Story

As a **Claude Code 开发者**,
I want **输入提示词时自动扫描是否包含 API 密钥等敏感信息**,
So that **我不小心在提示词中暴露敏感信息时被立即阻止**.

## Acceptance Criteria

1. **Given** 用户输入的提示词包含 API 密钥模式
   - **When** UserPromptSubmit 事件触发
   - **Then** 钩子返回 deny 决策，阻止该提示提交
   - **And** 拦截消息：`🛡️ [user-prompt-filter] 提示中含有敏感信息，已阻止`

2. **Given** 钩子内部异常崩溃
   - **When** 异常捕获
   - **Then** 返回 allow（fail-open），不阻塞用户输入

## Tasks / Subtasks

- [x] Task 1: 实现 user-prompt-filter.js 钩子 (AC: #1, #2)
  - [x] Subtask 1.1: 复用 protect-secrets.js 的 CONTENT_PATTERNS 作为敏感词模式
  - [x] Subtask 1.2: 从 stdin 读取 UserPromptSubmit 事件的 user_prompt 字段
  - [x] Subtask 1.3: 扫描 prompt 内容匹配 CONTENT_PATTERNS
  - [x] Subtask 1.4: 匹配到时返回 deny + 拦截消息
  - [x] Subtask 1.5: 异常时 fail-open（返回 `{}`）
  - [x] Subtask 1.6: 写入 JSONL 日志到 ~/.claude/hooks-logs/
- [x] Task 2: 注册钩子到 settings.json (AC: #1)
  - [x] Subtask 2.1: 在 UserPromptSubmit 事件中注册 user-prompt-filter.js
- [x] Task 3: 新增单元测试 (AC: #1, #2)
  - [x] Subtask 3.1: 测试 API 密钥检测（AWS、GitHub、OpenAI 等）
  - [x] Subtask 3.2: 测试信用卡号检测
  - [x] Subtask 3.3: 测试身份证号检测
  - [x] Subtask 3.4: 测试普通文本不被拦截
  - [x] Subtask 3.5: 测试异常 fail-open
  - [x] Subtask 3.6: 测试空输入处理

## Dev Notes

### Hook 协议

- 通过 stdin 接收 JSON：`{ tool_name, tool_input, session_id, cwd, permission_mode }`
- UserPromptSubmit 时 `tool_name` 为 `"UserPromptSubmit"`，用户输入在 `tool_input.user_prompt`
- 放行输出：`{}`
- 拒绝输出：`{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "permissionDecision": "deny", "permissionDecisionReason": "原因"}}`

### 可复用模块

- `protect-secrets.js` 导出的 `CONTENT_PATTERNS` 数组包含所有敏感内容正则
- `security-orchestrator.js` 提供 `readStdin()`、`log()`、`formatHookOutput()` 等工具函数

### 项目结构

- 钩子脚本：`.claude/hooks/user-prompt-filter.js`
- 测试文件：`.claude/hooks/__tests__/user-prompt-filter.test.js`
- 配置注册：`.claude/settings.json` → `hooks.UserPromptSubmit`

### References

- [Source: .claude/hooks/protect-secrets.js#CONTENT_PATTERNS]
- [Source: .claude/hooks/security-orchestrator.js]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2]
