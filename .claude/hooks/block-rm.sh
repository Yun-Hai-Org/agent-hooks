#!/bin/bash
# PreToolUse Hook - 阻止危险的 rm 命令
# 功能: 拦截包含 rm -rf 等危险操作的 Bash 命令

set -euo pipefail

# 读取 stdin 输入
INPUT=$(cat)

# 提取命令
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# 检查是否包含危险的 rm 命令
if echo "$COMMAND" | grep -qE 'rm\s+-rf?\s+/'; then
    # 阻止删除根目录或系统目录的操作
    jq -n '{
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "🚫 危险操作被阻止: 不允许删除根目录或系统目录"
        }
    }'
    exit 0
fi

# 检查是否包含 rm -rf（不带 / 的也警告）
if echo "$COMMAND" | grep -qE 'rm\s+-rf'; then
    jq -n '{
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "🚫 危险操作被阻止: rm -rf 命令需要手动确认"
        }
    }'
    exit 0
fi

# 检查是否包含 rm -rf /
if echo "$COMMAND" | grep -qE 'rm\s+-rf?\s+/'; then
    jq -n '{
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "🚫 危险操作被阻止: 不允许执行 rm -rf / 或类似命令"
        }
    }'
    exit 0
fi

# 允许其他命令通过
exit 0
