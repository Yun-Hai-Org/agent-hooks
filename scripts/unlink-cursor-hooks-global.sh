#!/usr/bin/env bash
# unlink-cursor-hooks-global.sh - 移除全局 Cursor 钩子软链接（hooks 仓库内开发时用，避免双触发）

set -euo pipefail

removed=0
for target in "$HOME/.cursor/hooks.json" "$HOME/.claude/hooks" "$HOME/.cursor/bun"; do
	if [[ -L "$target" ]]; then
		rm "$target"
		echo "removed symlink $target"
		removed=1
	fi
done

if [[ "$removed" -eq 0 ]]; then
	echo "no global hook symlinks found"
fi
