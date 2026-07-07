#!/usr/bin/env bash
# Global cosign verify — no-op pass when artifacts.txt is absent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS="${SCRIPT_DIR}/artifacts.txt"

if [[ ! -f "$ARTIFACTS" ]]; then
	echo "[cosign] no artifacts.txt — skip verify (pass)"
	exit 0
fi

while IFS= read -r image || [[ -n "$image" ]]; do
	[[ -z "$image" || "$image" =~ ^[[:space:]]*# ]] && continue
	cosign verify "$image"
done <"$ARTIFACTS"

echo "[cosign] all artifacts verified"
