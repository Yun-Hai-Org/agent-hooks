#!/usr/bin/env bash
# install-cursor-yingmi-hooks.sh - 将盈米 shell hooks 软链接到 ~/.cursor/hooks/
#
# 用法: ./scripts/install-cursor-yingmi-hooks.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$HOOKS_REPO/scripts/cursor-yingmi-hooks"
DEST="${HOME}/.cursor/hooks"

if [[ ! -d "$SRC" ]]; then
	echo "error: missing $SRC" >&2
	exit 1
fi

mkdir -p "$DEST"

HOOK_FILES=(
	session-init.sh
	dangerous-command-guard.sh
	prohibited-content-pretool-guard.sh
	security-standards.txt
	prohibited-keywords.txt
)

for name in "${HOOK_FILES[@]}"; do
	if [[ ! -f "$SRC/$name" ]]; then
		echo "error: missing $SRC/$name" >&2
		exit 1
	fi
	ln -sf "$SRC/$name" "$DEST/$name"
	case "$name" in
	*.sh)
		chmod +x "$DEST/$name"
		;;
	esac
done

echo "linked yingmi cursor hooks -> $DEST"
ls -la "${HOOK_FILES[@]/#/$DEST/}"
