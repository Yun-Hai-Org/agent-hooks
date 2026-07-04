#!/usr/bin/env bats
# shellcheck disable=SC2034

setup() {
	REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
	VALIDATOR="$REPO_ROOT/scripts/validate-hooks-json.example.sh"
}

@test "validate-hooks-json passes for repo manifest" {
	run bash "$VALIDATOR" "$REPO_ROOT"
	[ "$status" -eq 0 ]
	[[ "$output" == *"validate-hooks-json.example: ok"* ]]
}

@test "validate-hooks-json fails when manifest missing token" {
	local tmp
	tmp="$(mktemp -d)"
	mkdir -p "$tmp/.cursor"
	cp "$REPO_ROOT/.cursor/hooks.json.example" "$tmp/.cursor/"
	echo '{"requiredCommandTokens":["__missing_token__"],"requiredEvents":[]}' >"$tmp/.cursor/hooks-manifest.json"

	run bash "$VALIDATOR" "$tmp"
	[ "$status" -eq 1 ]
}
