#!/usr/bin/env bash
# install-quality-tools-global.sh - 一次性安装 quality-gate 依赖的机器级 CLI
#
# 项目级依赖（bun install / uv sync）仍需在各仓库内单独执行。

set -euo pipefail

echo "[install-quality-tools-global] Installing brew formulae (skip if unavailable)..."
if command -v brew >/dev/null 2>&1; then
	brew install gitleaks trivy semgrep shellcheck shfmt hadolint jq yq taplo kubeconform kube-linter oasdiff kind kubectl 2>/dev/null || true
	brew install osv-scanner pip-audit markdownlint-cli2 sqlfluff 2>/dev/null || true
else
	echo "  brew not found — install Homebrew tools manually"
fi

echo "[install-quality-tools-global] Installing uv tools..."
if command -v uv >/dev/null 2>&1; then
	uv tool install ruff 2>/dev/null || true
	uv tool install pyright 2>/dev/null || true
	uv tool install semgrep 2>/dev/null || true
	uv tool install pip-audit 2>/dev/null || true
	uv tool install sqlfluff 2>/dev/null || true
	uv tool install check-jsonschema 2>/dev/null || true
else
	echo "  uv not found — install uv first: https://docs.astral.sh/uv/"
fi

echo "[install-quality-tools-global] Ensure Cursor bun symlink..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -x "$HOOKS_REPO/.tools/bun-darwin-x64/bun" ]]; then
	mkdir -p "${HOME}/.cursor"
	ln -sf "$HOOKS_REPO/.tools/bun-darwin-x64/bun" "${HOME}/.cursor/bun"
	ln -sf "${HOME}/.cursor/bun" "${HOME}/.cursor/bunx"
fi

echo "[install-quality-tools-global] Done. Next: ./scripts/link-cursor-hooks-global.sh && ./scripts/install-git-hooks-global.sh"
