#!/bin/bash
# PreToolUse Hook - 文件写入前检查
# 功能: 在 Write/Edit 工具执行前进行预检查

set -euo pipefail

# 读取 stdin 输入
INPUT=$(cat)

# 提取文件路径
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# 如果没有文件路径，直接通过
if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# 检查是否是受保护的文件
PROTECTED_FILES=(".env" ".env.local" "config.json" "secrets.json")
BASENAME=$(basename "$FILE_PATH")

for protected in "${PROTECTED_FILES[@]}"; do
    if [ "$BASENAME" = "$protected" ]; then
        # 添加警告上下文
        jq -n --arg warning "⚠️ 注意: 你正在编辑受保护文件 $BASENAME，请确保不会泄露敏感信息。" '{
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                additionalContext: $warning
            }
        }'
        exit 0
    fi
done

# 检查文件大小（如果文件存在）
if [ -f "$FILE_PATH" ]; then
    FILE_SIZE=$(stat -f%z "$FILE_PATH" 2>/dev/null || stat -c%s "$FILE_PATH" 2>/dev/null || echo "0")
    # 如果文件大于 1MB，添加警告
    if [ "$FILE_SIZE" -gt 1048576 ]; then
        SIZE_MB=$(echo "scale=2; $FILE_SIZE / 1048576" | bc 2>/dev/null || echo ">1")
        jq -n --arg warning "📦 注意: 正在编辑的文件大小为 ${SIZE_MB}MB，操作可能需要一些时间。" '{
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                additionalContext: $warning
            }
        }'
        exit 0
    fi
fi

# 默认通过
exit 0
