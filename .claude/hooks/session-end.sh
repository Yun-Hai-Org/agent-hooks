#!/bin/bash
# SessionEnd Hook - 会话结束时执行
# 功能: 清理临时文件、记录会话日志、发送通知等

set -euo pipefail

# 读取 stdin 输入
INPUT=$(cat)

# 获取会话信息
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
CURRENT_TIME=$(date '+%Y-%m-%d %H:%M:%S')

# 记录会话结束日志
LOG_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/logs"
mkdir -p "$LOG_DIR"

echo "[$CURRENT_TIME] 会话结束 - Session ID: $SESSION_ID" >> "$LOG_DIR/session.log"

# 清理临时文件（如果有）
TEMP_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/tmp"
if [ -d "$TEMP_DIR" ]; then
    find "$TEMP_DIR" -type f -mtime +1 -delete 2>/dev/null || true
fi

exit 0
