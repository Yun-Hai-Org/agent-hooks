#!/usr/bin/env bash
# install-git-hooks-global.sh - 全局 Git quality gate hooks（一次安装，所有仓库生效）
#
# 前置：./scripts/link-cursor-hooks-global.sh（确保 ~/.claude/hooks 与 ~/.cursor/bun 可用）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$HOOKS_REPO/scripts/git-hooks-global"
DEST="${HOME}/.git-hooks"

if [[ ! -d "$SRC" ]]; then
	echo "error: missing $SRC" >&2
	exit 1
fi
if [[ ! -x "${HOME}/.cursor/bun" ]] && [[ ! -L "${HOME}/.cursor/bun" ]]; then
	echo "error: missing ${HOME}/.cursor/bun — run ./scripts/link-cursor-hooks-global.sh first" >&2
	exit 1
fi
if [[ ! -d "${HOME}/.claude/hooks" ]] && [[ ! -L "${HOME}/.claude/hooks" ]]; then
	echo "error: missing ${HOME}/.claude/hooks — run ./scripts/link-cursor-hooks-global.sh first" >&2
	exit 1
fi

mkdir -p "$DEST"
ln -sf "${HOME}/.cursor/bun" "${HOME}/.cursor/bunx" 2>/dev/null || true
for hook in pre-commit commit-msg pre-push pre-merge-commit; do
	cp "$SRC/$hook" "$DEST/$hook"
	chmod +x "$DEST/$hook"
done

git config --global core.hooksPath "$DEST"

if [ ! -f "$HOME/.claude/quality-gate.yaml" ] && [ -f "$HOOKS_REPO/.claude/quality-gate.example.yaml" ]; then
	cp "$HOOKS_REPO/.claude/quality-gate.example.yaml" "$HOME/.claude/quality-gate.yaml"
	echo "[install-git-hooks-global] bootstrapped ~/.claude/quality-gate.yaml"
fi

echo "[install-git-hooks-global] core.hooksPath=$(git config --global core.hooksPath)"
echo "[install-git-hooks-global] hooks deployed to $DEST"
ls -la "$DEST"

"$SCRIPT_DIR/configure-merge-no-ff-global.sh"
