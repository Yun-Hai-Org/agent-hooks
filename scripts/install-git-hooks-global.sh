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

BOOT="$HOOKS_REPO/templates/global-bootstrap"
mkdir -p "$HOME/.claude/policy" "$HOME/.claude/cosign"
if [ -d "$BOOT/policy" ]; then
	for f in "$BOOT/policy"/*.rego; do
		[ -f "$f" ] || continue
		dest="$HOME/.claude/policy/$(basename "$f")"
		[ -f "$dest" ] || install -m 644 "$f" "$dest"
	done
fi
if [ ! -x "$HOME/.claude/cosign/verify.sh" ] && [ -f "$BOOT/cosign/verify.sh" ]; then
	install -m 755 "$BOOT/cosign/verify.sh" "$HOME/.claude/cosign/verify.sh"
fi
if [ ! -f "$HOME/.claude/zap.env.example" ] && [ -f "$BOOT/zap.env.example" ]; then
	install -m 644 "$BOOT/zap.env.example" "$HOME/.claude/zap.env.example"
fi
echo "[install-git-hooks-global] bootstrapped ~/.claude fintech templates (if missing)"
echo "[install-git-hooks-global] hooks deployed to $DEST"
ls -la "$DEST"

"$SCRIPT_DIR/configure-merge-no-ff-global.sh"
