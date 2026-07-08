#!/usr/bin/env bash
# resolve-vendored-bun.sh - 从 HOOKS_REPO 或 git bare 根解析 vendored bun 路径
#
# 用法: source scripts/lib/resolve-vendored-bun.sh
#       resolve_vendored_bun_path /path/to/hooks-repo

set -euo pipefail

VENDORED_BUN_REL=".tools/bun-darwin-x64/bun"

_abs_path() {
	local p="$1"
	if [[ -d "$p" ]]; then
		(cd "$p" && pwd)
	elif [[ -f "$p" ]]; then
		local dir base
		dir="$(cd "$(dirname "$p")" && pwd)"
		base="$(basename "$p")"
		echo "$dir/$base"
	else
		echo "$p"
	fi
}

_git_common_dir_abs() {
	local repo="$1"
	local common
	common="$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null || true)"
	[[ -n "$common" ]] || return 1
	if [[ "$common" != /* ]]; then
		common="$(cd "$repo/$common" && pwd)"
	fi
	echo "$common"
}

_git_bare_root() {
	local repo="$1"
	local common bare
	common="$(_git_common_dir_abs "$repo")" || return 1
	bare="$(cd "$(dirname "$common")" && pwd)"
	echo "$bare"
}

# 输出可执行的 vendored bun 绝对路径；失败返回非 0
resolve_vendored_bun_path() {
	local repo="${1:?HOOKS_REPO required}"
	repo="$(_abs_path "$repo")"

	local candidate="$repo/$VENDORED_BUN_REL"
	if [[ -x "$candidate" ]]; then
		echo "$(_abs_path "$candidate")"
		return 0
	fi

	local bare_root
	if bare_root="$(_git_bare_root "$repo" 2>/dev/null)"; then
		candidate="$bare_root/$VENDORED_BUN_REL"
		if [[ -x "$candidate" ]]; then
			echo "$(_abs_path "$candidate")"
			return 0
		fi
	fi

	return 1
}

# 优先返回同时含 .claude/hooks 与 vendored bun 的仓库根（worktree 无 .tools 时上溯 bare）
resolve_hooks_repo_root() {
	local repo="${1:?HOOKS_REPO required}"
	repo="$(_abs_path "$repo")"

	if [[ -d "$repo/.claude/hooks" ]] && [[ -x "$repo/$VENDORED_BUN_REL" ]]; then
		echo "$repo"
		return 0
	fi

	local bare_root
	if bare_root="$(_git_bare_root "$repo" 2>/dev/null)"; then
		if [[ -d "$bare_root/.claude/hooks" ]] && [[ -x "$bare_root/$VENDORED_BUN_REL" ]]; then
			echo "$bare_root"
			return 0
		fi
	fi

	if [[ -d "$repo/.claude/hooks" ]]; then
		echo "$repo"
		return 0
	fi

	return 1
}
