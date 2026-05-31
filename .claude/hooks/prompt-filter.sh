#!/bin/bash
# UserPromptSubmit Hook - 用户提交提示时执行
# 功能: 检查用户提示，添加额外上下文或阻止某些操作

set -euo pipefail

# 读取 stdin 输入
INPUT=$(cat)

# 提取用户提示内容
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')

# 检查是否包含敏感关键词（示例）
SENSITIVE_KEYWORDS=("password" "secret" "token" "api_key" "private_key")
for keyword in "${SENSITIVE_KEYWORDS[@]}"; do
    if echo "$PROMPT" | grep -qi "$keyword"; then
        # 发现敏感词，添加警告上下文
        jq -n --arg warning "⚠️ 提示: 你的消息中可能包含敏感信息（如密码、密钥等）。请确保不要泄露机密信息。" '{
            hookSpecificOutput: {
                hookEventName: "UserPromptSubmit",
                additionalContext: $warning
            }
        }'
        exit 0
    fi
done

# 检查是否是代码相关的问题，添加相关上下文
if echo "$PROMPT" | grep -qiE "(code|代码|program|编程|script|脚本|function|函数)"; then
    # 获取当前目录的代码统计信息
    FILE_COUNT=$(find . -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')

    CONTEXT="💡 代码上下文提示:
- 当前目录包含 $FILE_COUNT 个文件
- 提示: 编写代码时建议遵循项目的代码规范和最佳实践"

    jq -n --arg context "$CONTEXT" '{
        hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: $context
        }
    }'
    exit 0
fi

# 默认: 无操作，正常通过
exit 0
