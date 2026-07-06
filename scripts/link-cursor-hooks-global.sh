#!/usr/bin/env bash
# link-cursor-hooks-global.sh - 将本项目钩子软链接到全局 Cursor/Claude 路径
#
# 用法: ./scripts/link-cursor-hooks-global.sh [--with-permissions-deny] [HOOKS_REPO]
# 默认 HOOKS_REPO 为脚本所在仓库根目录。
# --with-permissions-deny  链接完成后运行 sync-claude-permissions-deny.ts，合并 permissions.deny 到 ~/.claude/settings.json
#
# 双触发说明: 在本 hooks 仓库内打开 Cursor 时，若同时存在项目级 hooks.json
# 与全局 ~/.cursor/hooks.json，会各加载一次。策略 B：仅保留 .cursor/hooks.json.example
# 作源，全局软链指向它；本仓库不设 .cursor/hooks.json。见 apply-hooks-repo-strategy-b.sh。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WITH_PERMISSIONS_DENY=0
HOOKS_REPO=""

while [[ $# -gt 0 ]]; do
	case "$1" in
	--with-permissions-deny)
		WITH_PERMISSIONS_DENY=1
		shift
		;;
	-*)
		echo "error: unknown flag: $1" >&2
		exit 1
		;;
	*)
		HOOKS_REPO="$1"
		shift
		;;
	esac
done

HOOKS_REPO="${HOOKS_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"

if [[ ! -d "$HOOKS_REPO/.claude/hooks" ]]; then
	echo "error: missing $HOOKS_REPO/.claude/hooks" >&2
	exit 1
fi
if [[ ! -f "$HOOKS_REPO/.cursor/hooks.json.example" ]]; then
	echo "error: missing $HOOKS_REPO/.cursor/hooks.json.example" >&2
	exit 1
fi

"$SCRIPT_DIR/validate-hooks-json.example.sh" "$HOOKS_REPO"

if [[ -d "$HOME/.cursor/hooks" && ! -L "$HOME/.cursor/hooks" ]]; then
	backup="$HOME/.cursor/hooks.bak-$(date +%Y%m%d)"
	echo "backing up $HOME/.cursor/hooks -> $backup"
	mv "$HOME/.cursor/hooks" "$backup"
fi

"$SCRIPT_DIR/install-cursor-yingmi-hooks.sh"

if [[ -e "$HOME/.claude/hooks" && ! -L "$HOME/.claude/hooks" ]]; then
	echo "removing existing directory $HOME/.claude/hooks"
	rm -rf "$HOME/.claude/hooks"
fi

rm -f "$HOME/.cursor/hooks.json"

ln -sf "$HOOKS_REPO/.claude/hooks" "$HOME/.claude/hooks"
ln -sf "$HOOKS_REPO/.cursor/hooks.json.example" "$HOME/.cursor/hooks.json"
ln -sf "$HOOKS_REPO/.tools/bun-darwin-x64/bun" "$HOME/.cursor/bun"
ln -sf "$HOME/.cursor/bun" "$HOME/.cursor/bunx"

if [ ! -f "$HOME/.claude/quality-gate.yaml" ] && [ -f "$HOOKS_REPO/.claude/quality-gate.example.yaml" ]; then
	cp "$HOOKS_REPO/.claude/quality-gate.example.yaml" "$HOME/.claude/quality-gate.yaml"
	echo "bootstrapped ~/.claude/quality-gate.yaml from example"
fi

echo "linked ~/.claude/hooks -> $HOOKS_REPO/.claude/hooks"
echo "linked ~/.cursor/hooks.json -> $HOOKS_REPO/.cursor/hooks.json.example"
echo "linked ~/.cursor/bun -> $HOOKS_REPO/.tools/bun-darwin-x64/bun"
echo "linked ~/.cursor/bunx -> ~/.cursor/bun"
ls -la "$HOME/.claude/hooks" "$HOME/.cursor/hooks.json" "$HOME/.cursor/bun"

if [[ "$WITH_PERMISSIONS_DENY" -eq 1 ]]; then
	bun "$HOOKS_REPO/scripts/sync-claude-permissions-deny.ts"
fi
