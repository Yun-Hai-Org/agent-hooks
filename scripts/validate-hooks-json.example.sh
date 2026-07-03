#!/usr/bin/env bash
# validate-hooks-json.example.sh - 校验 .cursor/hooks.json.example 含必需 bun 链 token
#
# 用法: ./scripts/validate-hooks-json.example.sh [HOOKS_REPO]
# 退出码: 0 通过, 1 失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
HOOKS_JSON="$HOOKS_REPO/.cursor/hooks.json.example"

REQUIRED_TOKENS=(
	session-end-notify
	block-dangerous-commands
	resolve-hook-path.ts
	format-on-write
	auto-stage
)

if [[ ! -f "$HOOKS_JSON" ]]; then
	echo "error: missing $HOOKS_JSON" >&2
	exit 1
fi

content="$(cat "$HOOKS_JSON")"
failed=0

for token in "${REQUIRED_TOKENS[@]}"; do
	if [[ "$content" != *"$token"* ]]; then
		echo "error: hooks.json.example missing required token: $token" >&2
		failed=1
	fi
done

if [[ "$failed" -ne 0 ]]; then
	exit 1
fi

echo "validate-hooks-json.example: ok ($HOOKS_JSON)"
