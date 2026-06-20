#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "[install-git-hooks] core.hooksPath=$(git config core.hooksPath)"
