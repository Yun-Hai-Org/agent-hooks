#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

echo "[install-quality-tools] Installing Python dev deps via uv..."
if command -v uv >/dev/null 2>&1; then
	uv sync --group dev 2>/dev/null || uv pip install -e ".[dev]" 2>/dev/null || true
fi

echo "[install-quality-tools] Ensure bun dependencies..."
if command -v bun >/dev/null 2>&1 && [ -f package.json ]; then
	bun install 2>/dev/null || true
fi

echo "[install-quality-tools] Done. Run: ./scripts/install-git-hooks.sh"
