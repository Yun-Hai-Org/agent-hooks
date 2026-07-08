#!/usr/bin/env bash
# session-init.sh - 会话开始时注入盈米安全编码规范到 Agent 上下文
# 供 Cursor Agent sessionStart hook 调用
# 注意：若出现 "MainThreadShellExec not initialized"，多为 Cursor 在 sessionStart 时尚未就绪，可尝试用纯 bash 实现（见下方）

# 使用全局配置 ~/.cursor/hooks/（$HOME 确保在子进程与 Python 中路径正确展开）
STANDARDS_FILE="${HOME}/.cursor/hooks/security-standards.txt"

# 读取 stdin（Cursor 传入的 JSON），避免阻塞管道
cat > /dev/null

# 优先用 Python 输出 JSON；若失败或遇 Cursor 未就绪则用纯 bash 快速返回，减少时序问题
if [ -f "$STANDARDS_FILE" ] && command -v python3 >/dev/null 2>&1; then
  export STANDARDS_FILE
  out=$(python3 -c "
import json, pathlib, os
p = pathlib.Path(os.environ.get('STANDARDS_FILE',''))
ctx = p.read_text(encoding='utf-8') if p.exists() else ''
print(json.dumps({'additional_context': ctx, 'continue': True}, ensure_ascii=False))
" 2>/dev/null)
  if [ -n "$out" ]; then
    echo "$out"
    exit 0
  fi
fi
# 回退：纯 bash 输出，不依赖子进程，便于在 MainThreadShellExec 未就绪时仍能返回
echo '{"additional_context": "请遵循项目安全编码规范编写代码。", "continue": true}'
exit 0
