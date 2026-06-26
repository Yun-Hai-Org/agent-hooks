#!/usr/bin/env bash
# apply-hooks-repo-strategy-b.sh - hooks 仓库内仅使用全局 Cursor/Git hooks（策略 B）
#
# 1. 确认已执行 link-cursor-hooks-global.sh + install-git-hooks-global.sh
# 2. 本仓库无项目级 .cursor/hooks.json（仅保留 .cursor/hooks.json.example 作源）
# 3. 取消 local core.hooksPath，改用全局 ~/.git-hooks
#
# 用法: ./scripts/apply-hooks-repo-strategy-b.sh [HOOKS_REPO]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"

if [[ ! -f "$HOOKS_REPO/.cursor/hooks.json.example" ]]; then
	echo "error: missing $HOOKS_REPO/.cursor/hooks.json.example" >&2
	exit 1
fi

if [[ -f "$HOOKS_REPO/.cursor/hooks.json" ]]; then
	echo "error: remove or rename $HOOKS_REPO/.cursor/hooks.json (Strategy B uses global only)" >&2
	exit 1
fi

if [[ -L "$HOME/.cursor/hooks.json" ]]; then
	target="$(readlink "$HOME/.cursor/hooks.json")"
	if [[ "$target" != "$HOOKS_REPO/.cursor/hooks.json.example" ]]; then
		echo "relinking ~/.cursor/hooks.json -> .cursor/hooks.json.example"
		ln -sf "$HOOKS_REPO/.cursor/hooks.json.example" "$HOME/.cursor/hooks.json"
	fi
else
	echo "hint: run ./scripts/link-cursor-hooks-global.sh first" >&2
fi

if git -C "$HOOKS_REPO" config --local --get core.hooksPath >/dev/null 2>&1; then
	echo "unset local core.hooksPath in $HOOKS_REPO"
	git -C "$HOOKS_REPO" config --local --unset core.hooksPath
else
	echo "local core.hooksPath already unset in $HOOKS_REPO"
fi

echo "Strategy B applied. Restart Cursor to pick up global hooks only."
