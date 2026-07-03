#!/usr/bin/env bash
# hooks-doctor.sh - hooks 完整性检查与自动恢复
#
# 用法:
#   ./scripts/hooks-doctor.sh [HOOKS_REPO]              # L1+L2 检查
#   ./scripts/hooks-doctor.sh --repair [HOOKS_REPO]     # 检查并修复
#   ./scripts/hooks-doctor.sh --watch --repair          # 含 L4 存活检查
#   ./scripts/hooks-doctor.sh --json                    # JSON 报告
#   ./scripts/hooks-doctor.sh --quiet                   # 抑制非错误输出
#
# 退出码: 0 通过, 1 存在 ERROR

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPAIR=0
WATCH=0
JSON=0
QUIET=0
HOOKS_REPO=""

while [[ $# -gt 0 ]]; do
	case "$1" in
	--repair)
		REPAIR=1
		shift
		;;
	--watch)
		WATCH=1
		shift
		;;
	--json)
		JSON=1
		shift
		;;
	--quiet)
		QUIET=1
		shift
		;;
	-*)
		echo "error: unknown flag: $1" >&2
		exit 1
		;;
	*)
		HOOKS_REPO="$1"
		shift
		;;
	esac
done

if [[ -z "$HOOKS_REPO" ]]; then
	if [[ -L "${HOME}/.claude/hooks" ]]; then
		HOOKS_REPO="$(cd "$(readlink "${HOME}/.claude/hooks")/.." && pwd)"
		HOOKS_REPO="$(cd "$HOOKS_REPO/.." && pwd)"
	else
		HOOKS_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
	fi
fi

MANIFEST="$HOOKS_REPO/.cursor/hooks-manifest.json"
STATE_FILE="${HOME}/.claude/hooks-doctor-state.json"
AUDIT_LOG="${HOME}/.claude/hooks-logs/hooks-doctor.jsonl"
DEBOUNCE_SEC=600
REPORT_FILE="$(mktemp "${TMPDIR:-/tmp}/hooks-doctor.XXXXXX")"
trap 'rm -f "$REPORT_FILE"' EXIT

ERROR_COUNT=0
REPAIRED=0

expand_path() {
	local p="$1"
	if [[ "$p" == "$HOME" ]]; then
		echo "$HOME"
	elif [[ ${p:0:1} = ~ ]]; then
		echo "${HOME}${p:1}"
	else
		echo "$p"
	fi
}

log_msg() {
	if [[ "$QUIET" -eq 0 ]]; then
		echo "$1"
	fi
}

report() {
	local level="$1"
	local msg="$2"
	printf '%s\t%s\n' "$level" "$msg" >>"$REPORT_FILE"
	if [[ "$level" == "ERROR" ]]; then
		ERROR_COUNT=$((ERROR_COUNT + 1))
		echo "hooks-doctor ERROR: $msg" >&2
	fi
}

reset_errors() {
	ERROR_COUNT=0
	: >"$REPORT_FILE"
}

append_audit() {
	local payload="$1"
	mkdir -p "$(dirname "$AUDIT_LOG")"
	echo "$payload" >>"$AUDIT_LOG"
}

should_debounce_repair() {
	python3 - "$STATE_FILE" "$DEBOUNCE_SEC" <<'PY'
import json, sys, time
from datetime import datetime, timezone
path, debounce = sys.argv[1], int(sys.argv[2])
try:
    with open(path, encoding="utf-8") as f:
        state = json.load(f)
    last = state.get("lastRepairAt", "")
    if not last:
        sys.exit(1)
    ts = datetime.fromisoformat(last.replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    if time.time() - ts.timestamp() < debounce:
        sys.exit(0)
except (FileNotFoundError, json.JSONDecodeError, ValueError):
    pass
sys.exit(1)
PY
}

record_repair_state() {
	local reason="$1"
	mkdir -p "$(dirname "$STATE_FILE")"
	python3 - "$STATE_FILE" "$reason" <<'PY'
import json, sys
from datetime import datetime, timezone
path, reason = sys.argv[1], sys.argv[2]
state = {}
try:
    with open(path, encoding="utf-8") as f:
        state = json.load(f)
except FileNotFoundError:
    pass
state["lastRepairAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
state["lastRepairReason"] = reason
with open(path, "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)
    f.write("\n")
PY
}

send_notification() {
	local reason="$1"
	local bun="${HOME}/.cursor/bun"
	[[ -x "$bun" ]] || return 0
	(
		cd "$HOOKS_REPO/.claude/hooks"
		HOOKS_DOCTOR_MSG="$reason" HOOKS_DOCTOR_CWD="$HOOKS_REPO" HOOK_PLATFORM=cursor \
			"$bun" -e "
import { notifySecurityEventAsync } from './notify-security-event.ts';
notifySecurityEventAsync({
  hook: 'hooks-doctor',
  severity: 'high',
  reason: process.env.HOOKS_DOCTOR_MSG ?? '',
  cwd: process.env.HOOKS_DOCTOR_CWD ?? process.cwd(),
});
" 2>/dev/null
	) || true
}

check_l1_config() {
	local failed=0
	if [[ ! -f "$MANIFEST" ]]; then
		report ERROR "missing manifest: $MANIFEST"
		return 1
	fi
	if ! "$SCRIPT_DIR/validate-hooks-json.example.sh" "$HOOKS_REPO" >/dev/null 2>&1; then
		report ERROR "L1 validate-hooks-json.example.sh failed"
		failed=1
	fi
	if [[ "$failed" -eq 0 ]]; then
		report OK "L1 config integrity passed"
	fi
	return "$failed"
}

check_l2_deployment() {
	local failed=0

	python3 - "$MANIFEST" <<'PY' | while IFS=$'\t' read -r path suffix; do
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    manifest = json.load(f)
for item in manifest.get("requiredSymlinks", []):
    print(f"{item['path']}\t{item['targetSuffix']}")
PY
		local expanded target
		expanded="$(expand_path "$path")"
		if [[ ! -e "$expanded" ]]; then
			report ERROR "L2 missing symlink: $path"
			failed=1
			continue
		fi
		target=$(readlink "$expanded" 2>/dev/null || true)
		if [[ -z "$target" ]]; then
			report ERROR "L2 not a symlink: $path"
			failed=1
			continue
		fi
		if [[ "$target" != *"$suffix" ]]; then
			report ERROR "L2 symlink target mismatch: $path -> $target (expected *$suffix)"
			failed=1
		fi
	done

	local yingmi_dir asset asset_path
	yingmi_dir="$(expand_path "${HOME}/.cursor/hooks")"
	while IFS= read -r asset; do
		[[ -z "$asset" ]] && continue
		asset_path="$yingmi_dir/$asset"
		if [[ ! -f "$asset_path" ]]; then
			report ERROR "L2 missing yingmi asset: $asset_path"
			failed=1
			continue
		fi
		if [[ "$asset" == *.sh && ! -x "$asset_path" ]]; then
			report ERROR "L2 yingmi asset not executable: $asset_path"
			failed=1
		fi
	done < <(
		python3 - "$MANIFEST" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    manifest = json.load(f)
for asset in manifest.get("yingmiAssets", []):
    print(asset)
PY
	)

	local bun_path
	bun_path="$(expand_path "${HOME}/.cursor/bun")"
	if [[ ! -x "$bun_path" ]]; then
		report ERROR "L2 bun not executable: $bun_path"
		failed=1
	fi

	if [[ "$failed" -eq 0 ]]; then
		report OK "L2 deployment integrity passed"
	fi
	return "$failed"
}

check_l4_liveness() {
	local log_file
	log_file="${HOME}/.claude/hooks-logs/$(date +%Y-%m-%d).jsonl"
	if [[ ! -f "$log_file" ]]; then
		report ERROR "L4 no hooks log today: $log_file"
		return 1
	fi
	if python3 - "$log_file" <<'PY'; then
import json, sys, time
from datetime import datetime, timezone
path = sys.argv[1]
cutoff = time.time() - 3600
needles = ("resolve-hook-path", "auto-stage", "session-end-notify", "format-on-write")
found = False
with open(path, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = row.get("ts", "")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if dt.timestamp() < cutoff:
            continue
        blob = json.dumps(row)
        if any(n in blob for n in needles):
            found = True
            break
sys.exit(0 if found else 1)
PY
		report OK "L4 liveness passed"
		return 0
	else
		report ERROR "L4 no recent bun hook activity in $log_file"
		return 1
	fi
}

restore_hooks_json_from_git() {
	local ref_path
	ref_path=$(
		python3 - "$MANIFEST" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    manifest = json.load(f)
ref = manifest.get("gitRestoreRef", "HEAD:.cursor/hooks.json.example")
_, path = ref.split(":", 1)
print(path)
PY
	)
	if git -C "$HOOKS_REPO" rev-parse --git-dir >/dev/null 2>&1; then
		git -C "$HOOKS_REPO" checkout HEAD -- "$ref_path"
		log_msg "hooks-doctor: restored $ref_path from HEAD"
		return 0
	fi
	report ERROR "cannot git restore: not a git repo at $HOOKS_REPO"
	return 1
}

do_repair() {
	if should_debounce_repair; then
		log_msg "hooks-doctor: repair debounced (within ${DEBOUNCE_SEC}s)"
		return 0
	fi

	local l1_failed=0
	local l2_failed=0
	local repair_reason=""

	if ! check_l1_config; then
		l1_failed=1
		repair_reason="L1"
		restore_hooks_json_from_git || true
		if ! "$SCRIPT_DIR/validate-hooks-json.example.sh" "$HOOKS_REPO" >/dev/null 2>&1; then
			report ERROR "repair: validate still failing after git restore"
			append_audit "$(python3 -c 'import json,datetime; print(json.dumps({"ts":datetime.datetime.now(datetime.timezone.utc).isoformat(),"action":"repair","result":"L1_validate_failed"}))')"
			send_notification "hooks-doctor L1 repair failed after git restore"
			return 1
		fi
	fi

	if ! check_l2_deployment; then
		l2_failed=1
		[[ -z "$repair_reason" ]] && repair_reason="L2"
	fi

	if [[ "$l1_failed" -eq 1 || "$l2_failed" -eq 1 ]]; then
		"$SCRIPT_DIR/install-cursor-yingmi-hooks.sh"
		"$SCRIPT_DIR/link-cursor-hooks-global.sh" "$HOOKS_REPO"
		REPAIRED=1
		record_repair_state "${repair_reason:-repair}"
		append_audit "$(python3 -c "import json,datetime; print(json.dumps({'ts':datetime.datetime.now(datetime.timezone.utc).isoformat(),'action':'repair','reason':'${repair_reason:-repair}','repaired':True}))")"
		send_notification "hooks 已自动恢复（${repair_reason}），请重启 Cursor 生效"
		echo "hooks-doctor: 已自动修复 hooks，请重启 Cursor 生效" >&2
	fi
}

emit_json_report() {
	python3 - "$REPORT_FILE" "$ERROR_COUNT" "$REPAIRED" <<'PY'
import json, sys
report_path, errors, repaired = sys.argv[1], int(sys.argv[2]), sys.argv[3] == "1"
levels, messages = [], []
with open(report_path, encoding="utf-8") as f:
    for line in f:
        line = line.rstrip("\n")
        if not line:
            continue
        level, msg = line.split("\t", 1)
        levels.append(level)
        messages.append(msg)
print(json.dumps({"ok": errors == 0, "errors": errors, "repaired": repaired, "levels": levels, "messages": messages}))
PY
}

main() {
	if [[ ! -d "$HOOKS_REPO/.claude/hooks" ]]; then
		report ERROR "invalid HOOKS_REPO: $HOOKS_REPO"
		if [[ "$JSON" -eq 1 ]]; then emit_json_report; fi
		exit 1
	fi

	if [[ "$REPAIR" -eq 1 ]]; then
		do_repair
		reset_errors
	fi

	check_l1_config || true
	check_l2_deployment || true

	if [[ "$WATCH" -eq 1 ]]; then
		check_l4_liveness || true
	fi

	if [[ "$JSON" -eq 1 ]]; then
		emit_json_report
	elif [[ "$QUIET" -eq 0 && "$ERROR_COUNT" -eq 0 ]]; then
		log_msg "hooks-doctor: ok ($HOOKS_REPO)"
	fi

	if [[ "$ERROR_COUNT" -gt 0 ]]; then
		exit 1
	fi
}

main
