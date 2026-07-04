#!/usr/bin/env bats
# shellcheck disable=SC2034

setup() {
	GUARD="$BATS_TEST_DIRNAME/../../scripts/cursor-yingmi-hooks/prohibited-content-pretool-guard.sh"
	KEYWORDS="$BATS_TEST_DIRNAME/../../scripts/cursor-yingmi-hooks/prohibited-keywords.txt"
}

run_guard() {
	local payload="$1"
	echo "$payload" | env HOME="$BATS_TEST_TMPDIR" bash "$GUARD"
}

@test "allows non-write tools" {
	mkdir -p "$BATS_TEST_TMPDIR/.cursor/hooks"
	cp "$KEYWORDS" "$BATS_TEST_TMPDIR/.cursor/hooks/prohibited-keywords.txt"
	output="$(run_guard '{"tool_name":"Read","file_path":"README.md","content":"safe"}')"
	[[ "$output" == *'"permission":"allow"'* ]]
}

@test "denies write with prohibited keyword" {
	mkdir -p "$BATS_TEST_TMPDIR/.cursor/hooks"
	printf '%s\n' 'FORBIDDEN_TEST_KEYWORD' >"$BATS_TEST_TMPDIR/.cursor/hooks/prohibited-keywords.txt"
	output="$(run_guard '{"tool_name":"Write","file_path":"src/x.ts","content":"FORBIDDEN_TEST_KEYWORD"}')"
	[[ "$output" == *'"permission":"deny"'* ]]
}

@test "allows write without prohibited keyword" {
	mkdir -p "$BATS_TEST_TMPDIR/.cursor/hooks"
	printf '%s\n' 'FORBIDDEN_TEST_KEYWORD' >"$BATS_TEST_TMPDIR/.cursor/hooks/prohibited-keywords.txt"
	output="$(run_guard '{"tool_name":"Write","file_path":"src/x.ts","content":"hello world"}')"
	[[ "$output" == *'"permission":"allow"'* ]]
}
