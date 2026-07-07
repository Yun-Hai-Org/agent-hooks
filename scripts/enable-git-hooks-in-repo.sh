#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

git config --local --unset hooks.qualityGate 2>/dev/null || true
echo "[enable-git-hooks-in-repo] hooks.qualityGate unset for $ROOT"
