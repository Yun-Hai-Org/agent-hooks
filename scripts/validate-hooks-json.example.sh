#!/usr/bin/env bash
# validate-hooks-json.example.sh - 校验 .cursor/hooks.json.example 含 manifest 必需项
#
# 用法: ./scripts/validate-hooks-json.example.sh [HOOKS_REPO]
# 退出码: 0 通过, 1 失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
HOOKS_JSON="$HOOKS_REPO/.cursor/hooks.json.example"
MANIFEST="$HOOKS_REPO/.cursor/hooks-manifest.json"
VALIDATOR="$SCRIPT_DIR/lib/hooks_manifest_validator.py"

if [[ ! -f "$HOOKS_JSON" ]]; then
	echo "error: missing $HOOKS_JSON" >&2
	exit 1
fi

if [[ ! -f "$MANIFEST" ]]; then
	echo "error: missing $MANIFEST" >&2
	exit 1
fi

if [[ ! -f "$VALIDATOR" ]]; then
	echo "error: missing $VALIDATOR" >&2
	exit 1
fi

if ! python3 "$VALIDATOR" "$MANIFEST" "$HOOKS_JSON"; then
	exit 1
fi

echo "validate-hooks-json.example: ok ($HOOKS_JSON)"
