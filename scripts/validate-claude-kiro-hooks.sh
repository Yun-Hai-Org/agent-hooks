#!/usr/bin/env bash
# validate-claude-kiro-hooks.sh - 校验 Claude settings 与 Kiro hooks 含 manifest 必需 token
#
# 用法: ./scripts/validate-claude-kiro-hooks.sh [HOOKS_REPO]
# 退出码: 0 通过, 1 失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
MANIFEST="$HOOKS_REPO/.cursor/hooks-manifest.json"
CLAUDE_SETTINGS="$HOOKS_REPO/.claude/settings.json"
KIRO_HOOKS="$HOOKS_REPO/.kiro/hooks/hooks.json"

if [[ ! -f "$MANIFEST" ]]; then
	echo "error: missing $MANIFEST" >&2
	exit 1
fi

python3 - "$MANIFEST" "$CLAUDE_SETTINGS" "$KIRO_HOOKS" <<'PY'
import json
import sys

manifest_path, claude_path, kiro_path = sys.argv[1:4]
with open(manifest_path, encoding="utf-8") as f:
    manifest = json.load(f)
failed = False

if not __import__("os").path.isfile(claude_path):
    print(f"error: missing {claude_path}", file=sys.stderr)
    failed = True
else:
    claude_content = open(claude_path, encoding="utf-8").read()
    for token in manifest.get("requiredClaudeTokens", manifest.get("claudeRequiredTokens", [])):
        if token not in claude_content:
            print(f"error: .claude/settings.json missing required token: {token}", file=sys.stderr)
            failed = True

if not __import__("os").path.isfile(kiro_path):
    print(f"error: missing {kiro_path}", file=sys.stderr)
    failed = True
else:
    kiro_content = open(kiro_path, encoding="utf-8").read()
    for token in manifest.get("requiredKiroTokens", manifest.get("kiroRequiredTokens", [])):
        if token not in kiro_content:
            print(f"error: .kiro/hooks/hooks.json missing required token: {token}", file=sys.stderr)
            failed = True

sys.exit(1 if failed else 0)
PY

echo "validate-claude-kiro-hooks: ok ($CLAUDE_SETTINGS, $KIRO_HOOKS)"
