#!/bin/bash
# PostToolUse Hook - 文件写入后自动检查
# 功能: 在 Write/Edit 工具执行后运行自动检查（异步执行）

set -euo pipefail

# 读取 stdin 输入
INPUT=$(cat)

# 提取文件路径
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# 如果没有文件路径，直接退出
if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# 检查文件是否存在
if [ ! -f "$FILE_PATH" ]; then
    exit 0
fi

# 根据文件类型执行相应的检查
EXTENSION="${FILE_PATH##*.}"
LINT_RESULTS=""

# 检查 JSON 文件格式
if [ "$EXTENSION" = "json" ]; then
    if command -v python3 &>/dev/null; then
        if ! python3 -m json.tool "$FILE_PATH" > /dev/null 2>&1; then
            LINT_RESULTS="$LINT_RESULTS
❌ JSON 格式错误: $FILE_PATH"
        else
            LINT_RESULTS="$LINT_RESULTS
✅ JSON 格式验证通过: $FILE_PATH"
        fi
    fi
fi

# 检查 Python 文件
if [ "$EXTENSION" = "py" ]; then
    if command -v python3 &>/dev/null; then
        # 尝试语法检查
        if python3 -m py_compile "$FILE_PATH" 2>/dev/null; then
            LINT_RESULTS="$LINT_RESULTS
✅ Python 语法检查通过: $FILE_PATH"
        else
            LINT_RESULTS="$LINT_RESULTS
❌ Python 语法错误: $FILE_PATH"
        fi
    fi
fi

# 检查 Shell 脚本
if [ "$EXTENSION" = "sh" ]; then
    if command -v bash &>/dev/null; then
        if bash -n "$FILE_PATH" 2>/dev/null; then
            LINT_RESULTS="$LINT_RESULTS
✅ Shell 脚本语法检查通过: $FILE_PATH"
        else
            LINT_RESULTS="$LINT_RESULTS
❌ Shell 脚本语法错误: $FILE_PATH"
        fi
    fi
fi

# 如果有检查结果，输出到 stdout
if [ -n "$LINT_RESULTS" ]; then
    echo "$LINT_RESULTS"
fi

exit 0
