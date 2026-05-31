#!/bin/bash
# SessionStart Hook - 会话启动时执行
# 功能: 加载项目环境信息，为 Claude 提供上下文

set -euo pipefail

# 获取项目信息
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PROJECT_NAME=$(basename "$PROJECT_DIR")

# 获取 Git 信息（如果在 git 仓库中）
GIT_BRANCH=""
GIT_STATUS=""
if command -v git &>/dev/null && git -C "$PROJECT_DIR" rev-parse --git-dir &>/dev/null; then
    GIT_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "unknown")
    # 获取未提交文件数量
    UNCOMMITTED=$(git -C "$PROJECT_DIR" status --short 2>/dev/null | wc -l | tr -d ' ')
    if [ "$UNCOMMITTED" -gt 0 ]; then
        GIT_STATUS="$UNCOMMITTED 个未提交文件"
    else
        GIT_STATUS="工作区干净"
    fi
fi

# 获取当前时间
CURRENT_TIME=$(date '+%Y-%m-%d %H:%M:%S')

# 构建上下文信息
CONTEXT="📋 项目信息:
- 项目名称: $PROJECT_NAME
- 项目路径: $PROJECT_DIR
- 当前时间: $CURRENT_TIME"

if [ -n "$GIT_BRANCH" ]; then
    CONTEXT="$CONTEXT
- Git 分支: $GIT_BRANCH
- Git 状态: $GIT_STATUS"
fi

# 检查项目文件类型
if [ -f "$PROJECT_DIR/package.json" ]; then
    CONTEXT="$CONTEXT
- 检测到 Node.js 项目 (package.json)"
fi

if [ -f "$PROJECT_DIR/pyproject.toml" ] || [ -f "$PROJECT_DIR/requirements.txt" ]; then
    CONTEXT="$CONTEXT
- 检测到 Python 项目"
fi

if [ -f "$PROJECT_DIR/Cargo.toml" ]; then
    CONTEXT="$CONTEXT
- 检测到 Rust 项目 (Cargo.toml)"
fi

# 输出 JSON 格式的上下文信息
jq -n --arg context "$CONTEXT" '{
    hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: $context
    }
}'
