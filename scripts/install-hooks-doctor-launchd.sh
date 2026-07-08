#!/usr/bin/env bash
# install-hooks-doctor-launchd.sh - 安装 hooks-doctor macOS 定时任务（每 15 分钟）
#
# 用法: ./scripts/install-hooks-doctor-launchd.sh [HOOKS_REPO]
#
# 安装步骤:
#   1. ./scripts/link-cursor-hooks-global.sh [HOOKS_REPO]
#   2. ./scripts/install-cursor-yingmi-hooks.sh
#   3. ./scripts/install-hooks-doctor-launchd.sh [HOOKS_REPO]
#   4. 重启 Cursor
#   5. 验证: launchctl print gui/$(id -u)/com.hooks.doctor
#
# 定时任务执行: hooks-doctor.sh --watch --repair --quiet（含 L4 指标 + L6 通知对账）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DOCTOR="$HOOKS_REPO/scripts/hooks-doctor.sh"
PLIST_LABEL="com.hooks.doctor"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"

if [[ ! -x "$DOCTOR" ]]; then
	chmod +x "$DOCTOR"
fi

mkdir -p "${HOME}/Library/LaunchAgents"

cat >"$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${PLIST_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${DOCTOR}</string>
		<string>--watch</string>
		<string>--repair</string>
		<string>--quiet</string>
		<string>${HOOKS_REPO}</string>
	</array>
	<key>StartInterval</key>
	<integer>900</integer>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${HOME}/.claude/hooks-logs/hooks-doctor-launchd.out.log</string>
	<key>StandardErrorPath</key>
	<string>${HOME}/.claude/hooks-logs/hooks-doctor-launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/${PLIST_LABEL}"
launchctl kickstart -k "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true

echo "installed launchd agent: $PLIST_PATH (StartInterval=900s)"
