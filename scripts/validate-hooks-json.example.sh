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

if [[ ! -f "$HOOKS_JSON" ]]; then
	echo "error: missing $HOOKS_JSON" >&2
	exit 1
fi

if [[ ! -f "$MANIFEST" ]]; then
	echo "error: missing $MANIFEST" >&2
	exit 1
fi

validate_with_python() {
	python3 - "$MANIFEST" "$HOOKS_JSON" <<'PY'
import json
import sys

manifest_path, hooks_path = sys.argv[1], sys.argv[2]
with open(manifest_path, encoding="utf-8") as f:
    manifest = json.load(f)
with open(hooks_path, encoding="utf-8") as f:
    hooks_doc = json.load(f)
content = open(hooks_path, encoding="utf-8").read()
failed = False

for token in manifest.get("requiredCommandTokens", []):
    if token not in content:
        print(f"error: hooks.json.example missing required token: {token}", file=sys.stderr)
        failed = True

hooks = hooks_doc.get("hooks", {})
for event in manifest.get("requiredEvents", []):
    entries = hooks.get(event)
    if not isinstance(entries, list) or len(entries) == 0:
        print(f"error: hooks.json.example missing required event: {event}", file=sys.stderr)
        failed = True

sys.exit(1 if failed else 0)
PY
}

if ! validate_with_python; then
	exit 1
fi

echo "validate-hooks-json.example: ok ($HOOKS_JSON)"
