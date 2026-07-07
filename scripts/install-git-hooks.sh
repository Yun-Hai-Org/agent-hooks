#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -e .githooks ]] || [[ -L .githooks ]]; then
	ln -sfn "$HOOKS_REPO/.githooks" .githooks
fi

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "[install-git-hooks] core.hooksPath=$(git config core.hooksPath)"
