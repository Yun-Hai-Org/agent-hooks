#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

git config --local hooks.qualityGate false
echo "[disable-git-hooks-in-repo] hooks.qualityGate=false for $ROOT"
