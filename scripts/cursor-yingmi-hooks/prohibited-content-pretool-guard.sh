#!/usr/bin/env bash
# preToolUse guard for Write/TabWrite.

set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

json_escape() {
	local value="${1-}"
	value="${value//\\/\\\\}"
	value="${value//\"/\\\"}"
	value="${value//$'\n'/\\n}"
	value="${value//$'\r'/\\r}"
	value="${value//$'\t'/\\t}"
	printf '%s' "$value"
}

print_allow() {
	printf '{"permission":"allow"}\n'
}

print_deny() {
	local message="$1"
	local keyword="${2-}"

	if [[ -n "$keyword" ]]; then
		printf '{"permission":"deny","user_message":"%s","agent_message":"检测到违禁内容，请移除后再尝试写入。","matched_keyword":"%s"}\n' \
			"$message" "$(json_escape "$keyword")"
	else
		printf '{"permission":"deny","user_message":"%s","agent_message":"检测到违禁内容，请移除后再尝试写入。"}\n' \
			"$message"
	fi
}

raw_input="$(</dev/stdin)"
if [[ -z "$raw_input" ]]; then
	print_deny "写入前合规检查无法解析请求，已拒绝本次写入。"
	exit 0
fi

tool_name=""
if [[ "$raw_input" =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]]; then
	tool_name="${BASH_REMATCH[1]}"
else
	print_deny "写入前合规检查无法解析请求，已拒绝本次写入。"
	exit 0
fi

if [[ "$tool_name" != "Write" && "$tool_name" != "TabWrite" ]]; then
	print_allow
	exit 0
fi

file_path=""
if [[ "$raw_input" =~ \"file_path\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]]; then
	file_path="${BASH_REMATCH[1]}"
fi

if [[ "$file_path" == */.cursor/hooks/prohibited-keywords.txt ]]; then
	print_allow
	exit 0
fi

keyword_file=""
for candidate in "$HOME/.cursor/hooks/prohibited-keywords.txt" "$SCRIPT_DIR/prohibited-keywords.txt"; do
	if [[ -f "$candidate" ]]; then
		keyword_file="$candidate"
		break
	fi
done

if [[ -z "$keyword_file" ]]; then
	print_allow
	exit 0
fi

shopt -s extglob
while IFS= read -r line || [[ -n "$line" ]]; do
	keyword="${line##+([[:space:]])}"
	keyword="${keyword%%+([[:space:]])}"
	if [[ -z "$keyword" || "$keyword" == \#* ]]; then
		continue
	fi

	if [[ "$raw_input" == *"$keyword"* ]]; then
		print_deny "检测到违禁内容，不得写入代码仓库。" "$keyword"
		exit 0
	fi
done <"$keyword_file"

print_allow
