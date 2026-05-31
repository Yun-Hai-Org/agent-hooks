#!/bin/bash
# Stop Hook - 回合结束时执行
# 功能: 在 Claude 完成回复后记录信息

set -euo pipefail

# 读取 stdin 输入
INPUT=$(cat)

CURRENT_TIME=$(date '+%Y-%m-%d %H:%M:%S')

# 获取文件变更统计（如果有）
if command -v git &>/dev/null && git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --git-dir &>/dev/null; then
    CHANGED_FILES=$(git -C "${CLAUDE_PROJECT_DIR:-.}" status --short 2>/dev/null | wc -l | tr -d ' ')
    if [ "$CHANGED_FILES" -gt 0 ]; then
        echo "📝 回合结束 ($CURRENT_TIME): $CHANGED_FILES 个文件有变更"
    fi
fi

exit 0
