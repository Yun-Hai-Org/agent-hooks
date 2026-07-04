#!/usr/bin/env bats
# shellcheck disable=SC2034

setup() {
	SESSION_INIT="$BATS_TEST_DIRNAME/../../scripts/cursor-yingmi-hooks/session-init.sh"
}

run_session_init() {
	echo '{}' | env HOME="$BATS_TEST_TMPDIR" bash "$SESSION_INIT"
}

@test "returns JSON with additional_context fallback" {
	output="$(run_session_init)"
	[[ "$output" == *'"additional_context"'* ]]
	[[ "$output" == *'"continue": true'* ]]
}

@test "loads security standards when file exists" {
	mkdir -p "$BATS_TEST_TMPDIR/.cursor/hooks"
	printf '%s' 'TEST_SECURITY_STANDARDS' >"$BATS_TEST_TMPDIR/.cursor/hooks/security-standards.txt"
	output="$(run_session_init)"
	[[ "$output" == *'TEST_SECURITY_STANDARDS'* ]]
}
