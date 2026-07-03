#!/usr/bin/env bash
# dangerous-command-guard.sh - 危险命令守卫
# 在 beforeShellExecution 中运行：对明确危险的命令直接拒绝，其余交给后续 prompt hook 判断

set -e
input=$(cat)

# 解析待执行命令（兼容无 jq 环境）
command=""
if command -v jq >/dev/null 2>&1; then
	command=$(echo "$input" | jq -r '.command // empty')
else
	# 简单提取 "command": "..." 内容（避免依赖 jq）
	if [[ "$input" =~ \"command\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]]; then
		command="${BASH_REMATCH[1]}"
	fi
fi

# 统一转为单行并规范化空白，便于匹配
command_norm=$(echo "$command" | tr '\n' ' ' | sed 's/  */ /g' | sed 's/^ *//;s/ *$//')

deny() {
	local user_msg="$1"
	local agent_msg="$2"
	if command -v jq >/dev/null 2>&1; then
		jq -n --arg u "$user_msg" --arg a "$agent_msg" '{continue: true, permission: "deny", user_message: $u, agent_message: $a}'
	else
		# 无 jq 时输出简单单行 JSON（消息中勿含未转义双引号）
		echo "{\"continue\": true, \"permission\": \"deny\", \"user_message\": \"安全策略禁止执行该命令。\", \"agent_message\": \"该命令已被安全策略拒绝，请勿执行危险操作。\"}"
	fi
	exit 0
}

allow() {
	echo '{"continue": true, "permission": "allow"}'
	exit 0
}

# 无命令则放行（由 Cursor 或后续 hook 处理）
[ -z "$command_norm" ] && allow

# 高危：直接删除系统根或关键路径
if [[ "$command_norm" =~ rm[[:space:]]+-[rf]+[[:space:]]*/ ]]; then
	deny "禁止执行针对系统关键目录的递归删除。" "该 rm 命令针对系统关键路径，已被安全策略拒绝。请仅在项目目录内执行删除，并避免使用 -rf / 等危险用法。"
fi
# 高危：格式化或直接写磁盘设备
# format 使用词边界，避免 information / information_schema 等子串误报
dev_write_re='[^[:space:]]+>[[:space:]]*/dev/sd'
if [[ "$command_norm" =~ mkfs ]] ||
	[[ "$command_norm" =~ (^|[[:space:]]|/)format([^[:alnum:]_]|$) ]] ||
	[[ "$command_norm" =~ dd[[:space:]]+if= ]] ||
	[[ "$command_norm" =~ $dev_write_re ]]; then
	deny "禁止执行格式化或直接写磁盘设备。" "该命令可能格式化磁盘或写入裸设备，已被安全策略拒绝。"
fi

# 高危：未受控的从网络执行脚本（curl xxx | bash 等）
if [[ "$command_norm" =~ (curl|wget)[^|]*\|[^|]*(bash|sh|zsh) ]]; then
	deny "禁止直接通过 curl/wget 管道执行远程脚本。" "请先下载脚本到本地，审查后再执行。"
fi

# 高危：修改系统级权限或敏感配置
if [[ "$command_norm" =~ chmod[[:space:]]+[0-7]*[67][67][67][[:space:]]+/ ]]; then
	deny "禁止对系统路径执行 chmod 777/666。" "请勿对系统目录或根路径放宽权限。"
fi

# 若未命中上述规则，则放行并由后续 prompt-type hook 做 LLM 判断
allow
