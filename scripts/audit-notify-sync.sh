#!/usr/bin/env bash
# audit-notify-sync.sh - BLOCKED 与 session-end 通知对账
#
# 用法:
#   ./scripts/audit-notify-sync.sh [--date YYYY-MM-DD|today] [--json] [--quiet]
#
# 退出码: 0 无缺口, 1 存在未配对 BLOCKED 或对话结束缺口

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE_ARG=""
JSON=0
QUIET=0

while [[ $# -gt 0 ]]; do
	case "$1" in
	--date)
		DATE_ARG="${2:-}"
		shift 2
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
		DATE_ARG="$1"
		shift
		;;
	esac
done

if [[ -z "$DATE_ARG" || "$DATE_ARG" == "today" ]]; then
	DATE_ARG="$(date +%Y-%m-%d)"
fi

LOG_FILE="${HOME}/.claude/hooks-logs/${DATE_ARG}.jsonl"
if [[ ! -f "$LOG_FILE" ]]; then
	if [[ "$JSON" -eq 1 ]]; then
		echo "{\"ok\":true,\"date\":\"$DATE_ARG\",\"reason\":\"no_log_file\",\"blocked_gaps\":[],\"session_end_gaps\":[]}"
	elif [[ "$QUIET" -eq 0 ]]; then
		echo "audit-notify-sync: no log file $LOG_FILE"
	fi
	exit 0
fi

python3 - "$LOG_FILE" "$DATE_ARG" "$JSON" "$QUIET" <<'PY'
import json, sys
from collections import defaultdict
from datetime import datetime, timezone

log_path, date_arg, json_mode, quiet = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])

BLOCKED_WINDOW_SEC = 30
SESSION_END_WINDOW_SEC = 60
NOTIFY_HOOKS = {"notify-security-event", "notification-hook"}
SESSION_END_HOOK = "session-end-notify"
SESSION_END_TRIGGERS = {
    "stop", "sessionend", "session-end-notify", "workflow-stop-gate", "auto-commit"
}
EXCLUDE_HOOKS = {
    "workflow-gate", "workflow-stop-gate", "orchestrator-gate", "hooks-doctor"
}
TEST_PATH_MARKERS = ("/tmp/", "/var/folders/", "bun-test", "test-home")


def parse_ts(raw):
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return None


def is_test_row(row):
    blob = json.dumps(row, ensure_ascii=False).lower()
    if any(m in blob for m in TEST_PATH_MARKERS):
        return True
    session = str(row.get("session_id", ""))
    if session.startswith("test-") or session.startswith("sess-test"):
        return True
    cwd = str(row.get("cwd", ""))
    if "feat/" in cwd and "/tmp/" in cwd:
        return True
    return False


def project_name(cwd):
    if not cwd:
        return "unknown"
    parts = str(cwd).rstrip("/").split("/")
    return parts[-1] if parts else "unknown"


rows = []
with open(log_path, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if is_test_row(row):
            continue
        row["_ts"] = parse_ts(row.get("ts"))
        rows.append(row)

notify_events = []
blocked_events = []
session_end_events = []
session_end_notify_events = []

for row in rows:
    hook = str(row.get("hook", ""))
    level = str(row.get("level", ""))
    ts = row.get("_ts")
    if ts is None:
        continue

    if hook in NOTIFY_HOOKS and level in ("INFO", "METRIC"):
        outcome = str(row.get("outcome", ""))
        success = int(row.get("success", 0) or 0)
        if outcome in ("sent", "skipped", "failed") or success > 0:
            notify_events.append(row)

    if level == "BLOCKED" and hook not in EXCLUDE_HOOKS:
        blocked_events.append(row)

    if hook == SESSION_END_HOOK and level in ("INFO", "METRIC", "SKIP"):
        session_end_notify_events.append(row)

    hook_norm = hook.replace("_", "").lower()
    if hook_norm in SESSION_END_TRIGGERS and level == "BLOCKED":
        session_end_events.append(row)
    if hook_norm in {"stop", "sessionend"} or hook in {"session-end-notify", "workflow-stop-gate"}:
        if level not in ("SKIP", "ERROR"):
            session_end_events.append(row)

# dedupe session end triggers by session + ts bucket
seen_session_triggers = set()
deduped_session_end = []
for row in session_end_events:
    key = (str(row.get("session_id", "")), int(row.get("_ts", 0) // 5))
    if key in seen_session_triggers:
        continue
    seen_session_triggers.add(key)
    deduped_session_end.append(row)
session_end_events = deduped_session_end


def nearest_match(events, target_ts, window_sec, predicate):
    best = None
    best_delta = None
    for ev in events:
        if not predicate(ev):
            continue
        delta = abs(ev["_ts"] - target_ts)
        if delta <= window_sec and (best_delta is None or delta < best_delta):
            best = ev
            best_delta = delta
    return best


blocked_gaps = []
for blocked in blocked_events:
    matched = nearest_match(
        notify_events,
        blocked["_ts"],
        BLOCKED_WINDOW_SEC,
        lambda ev: True,
    )
    if matched is None:
        blocked_gaps.append({
            "ts": blocked.get("ts"),
            "hook": blocked.get("hook"),
            "reason": str(blocked.get("reason", ""))[:200],
            "cwd": blocked.get("cwd"),
            "project": project_name(blocked.get("cwd")),
            "session_id": blocked.get("session_id"),
        })

session_end_gaps = []
for trigger in session_end_events:
    matched = nearest_match(
        session_end_notify_events,
        trigger["_ts"],
        SESSION_END_WINDOW_SEC,
        lambda ev: True,
    )
    if matched is None:
        reason = str(trigger.get("reason", trigger.get("level", "")))
        session_end_gaps.append({
            "ts": trigger.get("ts"),
            "hook": trigger.get("hook"),
            "reason": reason[:200],
            "cwd": trigger.get("cwd"),
            "project": project_name(trigger.get("cwd")),
            "session_id": trigger.get("session_id"),
            "gap_type": "missing_session_end_notify",
        })
    else:
        skip_reason = str(matched.get("reason", ""))
        if matched.get("level") == "SKIP" and skip_reason in ("trigger_filtered", "empty_summary", "empty summary"):
            session_end_gaps.append({
                "ts": trigger.get("ts"),
                "hook": trigger.get("hook"),
                "reason": skip_reason,
                "cwd": trigger.get("cwd"),
                "project": project_name(trigger.get("cwd")),
                "session_id": trigger.get("session_id"),
                "gap_type": skip_reason,
            })

by_project_blocked = defaultdict(int)
for gap in blocked_gaps:
    by_project_blocked[gap["project"]] += 1

by_project_session = defaultdict(int)
for gap in session_end_gaps:
    by_project_session[gap["project"]] += 1

wechat_sent = sum(
    1 for ev in notify_events
    if str(ev.get("outcome")) == "sent" or int(ev.get("success", 0) or 0) > 0
)
wechat_skipped = sum(1 for ev in notify_events if str(ev.get("outcome")) == "skipped")

ok = len(blocked_gaps) == 0 and len(session_end_gaps) == 0
report = {
    "ok": ok,
    "date": date_arg,
    "log_file": log_path,
    "blocked_total": len(blocked_events),
    "blocked_gaps": blocked_gaps,
    "session_end_triggers": len(session_end_events),
    "session_end_gaps": session_end_gaps,
    "notify_sent": wechat_sent,
    "notify_skipped": wechat_skipped,
    "by_project_blocked": dict(by_project_blocked),
    "by_project_session_end": dict(by_project_session),
}

if json_mode:
    print(json.dumps(report, ensure_ascii=False))
else:
    if quiet == 0:
        print(f"audit-notify-sync: date={date_arg} blocked={len(blocked_events)} gaps={len(blocked_gaps)} session_end_gaps={len(session_end_gaps)}")
        if blocked_gaps:
            print("unpaired BLOCKED:")
            for gap in blocked_gaps[:20]:
                print(f"  - {gap['ts']} {gap['hook']} [{gap['project']}] {gap['reason']}")
        if session_end_gaps:
            print("session-end gaps:")
            for gap in session_end_gaps[:20]:
                print(f"  - {gap['ts']} {gap['hook']} [{gap['project']}] {gap.get('gap_type', gap['reason'])}")

sys.exit(0 if ok else 1)
PY
