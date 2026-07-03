#!/usr/bin/env bash
# bootstrap-global-quality-gate.sh — 用 example 升级 ~/.claude/quality-gate.yaml，保留 notifications
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLE="$HOOKS_REPO/.claude/quality-gate.example.yaml"
GLOBAL="${HOME}/.claude/quality-gate.yaml"
BUN="${HOME}/.cursor/bun"

if [[ ! -f "$EXAMPLE" ]]; then
	echo "error: missing $EXAMPLE" >&2
	exit 1
fi
if [[ ! -x "$BUN" ]]; then
	BUN="$(command -v bun || true)"
fi
if [[ -z "$BUN" ]]; then
	echo "error: bun not found — run ./scripts/link-cursor-hooks-global.sh first" >&2
	exit 1
fi

mkdir -p "${HOME}/.claude"

if [[ -f "$GLOBAL" ]]; then
	backup="${GLOBAL}.bak-$(date +%Y%m%d%H%M%S)"
	cp "$GLOBAL" "$backup"
	echo "[bootstrap-global-quality-gate] backed up -> $backup"
fi

"$BUN" -e "
import { readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';

const examplePath = process.argv[1];
const globalPath = process.argv[2];
const example = yaml.load(readFileSync(examplePath, 'utf8')) ?? {};
let notifications;
try {
  const existing = yaml.load(readFileSync(globalPath, 'utf8')) ?? {};
  notifications = existing?.settings?.notifications;
} catch {}
if (!example.settings) example.settings = {};
if (notifications) example.settings.notifications = notifications;
writeFileSync(globalPath, yaml.dump(example, { lineWidth: 120, noRefs: true }), 'utf8');
" "$EXAMPLE" "$GLOBAL"

echo "[bootstrap-global-quality-gate] wrote $GLOBAL from example (notifications preserved if present)"
