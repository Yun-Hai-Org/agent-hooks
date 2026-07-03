#!/usr/bin/env bash
# uninstall-hooks-doctor-launchd.sh - 卸载 hooks-doctor macOS 定时任务

set -euo pipefail

PLIST_LABEL="com.hooks.doctor"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "removed launchd agent: $PLIST_LABEL"
