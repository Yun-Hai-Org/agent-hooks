#!/usr/bin/env bash
# verify-ship-readiness.sh - merge-sa preflight: hooks-doctor + full quality gate
#
# Usage:
#   ./scripts/verify-ship-readiness.sh [REPO_ROOT]
#
# Exit: 0 ready, 1 blocked

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

if ! DOCTOR_JSON="$(./scripts/hooks-doctor.sh --json 2>/dev/null)"; then
	echo "verify-ship-readiness: hooks-doctor failed" >&2
	exit 1
fi

if ! echo "$DOCTOR_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") else 1)'; then
	echo "verify-ship-readiness: hooks-doctor not ok" >&2
	echo "$DOCTOR_JSON" >&2
	exit 1
fi

BUN="${HOME}/.cursor/bun"
if [[ ! -x "$BUN" ]]; then
	BUN="bun"
fi

"$BUN" "$REPO_ROOT/.claude/hooks/quality-gate.ts" --profile=full --cwd="$REPO_ROOT"
