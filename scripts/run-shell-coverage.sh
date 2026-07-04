#!/usr/bin/env bash
# run-shell-coverage.sh - Run bats shell tests; optional kcov when installed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BATS_DIR="$REPO_ROOT/tests/shell"

if ! command -v bats >/dev/null 2>&1; then
	echo "error: bats not installed (brew install bats-core)" >&2
	exit 1
fi

if [[ ! -d "$BATS_DIR" ]]; then
	echo "error: missing $BATS_DIR" >&2
	exit 1
fi

run_bats() {
	bats "$BATS_DIR"
}

if command -v kcov >/dev/null 2>&1; then
	KCOV_OUT="$REPO_ROOT/.coverage/shell-kcov"
	mkdir -p "$KCOV_OUT"
	echo "run-shell-coverage: running bats under kcov -> $KCOV_OUT"
	kcov --exclude-pattern='bats,bats-core,tests/shell' "$KCOV_OUT" bats "$BATS_DIR"
else
	echo "run-shell-coverage: kcov not installed, SKIP coverage (brew install kcov)"
	run_bats
fi

echo "run-shell-coverage: ok"
