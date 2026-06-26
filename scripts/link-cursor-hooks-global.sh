#!/usr/bin/env bash
# link-cursor-hooks-global.sh - 将本项目钩子软链接到全局 Cursor/Claude 路径
#
# 用法: ./scripts/link-cursor-hooks-global.sh [HOOKS_REPO]
# 默认 HOOKS_REPO 为脚本所在仓库根目录。
#
# 双触发说明: 在本 hooks 仓库内打开 Cursor 时，项目级与用户级可能各加载一次
# hooks.json。开发调试时可运行 ./scripts/unlink-cursor-hooks-global.sh 临时移除全局软链。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"

if [[ ! -d "$HOOKS_REPO/.claude/hooks" ]]; then
	echo "error: missing $HOOKS_REPO/.claude/hooks" >&2
	exit 1
fi
if [[ ! -f "$HOOKS_REPO/.cursor/hooks.json" ]]; then
	echo "error: missing $HOOKS_REPO/.cursor/hooks.json" >&2
	exit 1
fi

if [[ -d "$HOME/.cursor/hooks" && ! -L "$HOME/.cursor/hooks" ]]; then
	backup="$HOME/.cursor/hooks.bak-$(date +%Y%m%d)"
	echo "backing up $HOME/.cursor/hooks -> $backup"
	mv "$HOME/.cursor/hooks" "$backup"
fi

if [[ -e "$HOME/.claude/hooks" && ! -L "$HOME/.claude/hooks" ]]; then
	echo "removing existing directory $HOME/.claude/hooks"
	rm -rf "$HOME/.claude/hooks"
fi

rm -f "$HOME/.cursor/hooks.json"

ln -sf "$HOOKS_REPO/.claude/hooks" "$HOME/.claude/hooks"
ln -sf "$HOOKS_REPO/.cursor/hooks.json" "$HOME/.cursor/hooks.json"
ln -sf "$HOOKS_REPO/.tools/bun-darwin-x64/bun" "$HOME/.cursor/bun"
ln -sf "$HOME/.cursor/bun" "$HOME/.cursor/bunx"

echo "linked ~/.claude/hooks -> $HOOKS_REPO/.claude/hooks"
echo "linked ~/.cursor/hooks.json -> $HOOKS_REPO/.cursor/hooks.json"
echo "linked ~/.cursor/bun -> $HOOKS_REPO/.tools/bun-darwin-x64/bun"
echo "linked ~/.cursor/bunx -> ~/.cursor/bun"
ls -la "$HOME/.claude/hooks" "$HOME/.cursor/hooks.json" "$HOME/.cursor/bun"
