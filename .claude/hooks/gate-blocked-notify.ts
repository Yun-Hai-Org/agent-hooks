#!/usr/bin/env bun
/**
 * Gate Blocked Notify - 统一 BLOCKED 事件 Webhook 通知
 */

import { getOnBlockedNotificationSettings } from './gate-config.js';
import { notifySecurityEventAsync } from './notify-security-event.js';
import { DECISION_VALUES } from './types.js';
import type { CheckResult } from './types.js';

const DEFAULT_EXCLUDE_HOOKS = new Set([
  'workflow-gate',
  'workflow-stop-gate',
  'orchestrator-gate',
  'branch-gate',
  'block-dangerous-commands',
  'protect-secrets',
  'hooks-doctor',
]);

export interface GateBlockedNotifyInput {
  hook: string;
  reason: string;
  cwd?: string;
  session_id?: string;
  severity?: string;
  checks?: CheckResult[] | Array<{ id?: string; decision?: string; message?: string }>;
}

function summarizeChecks(
  checks?: GateBlockedNotifyInput['checks'],
): string {
  if (!checks?.length) return '';
  const deny = checks.find((c) => {
    const decision = 'decision' in c ? c.decision : undefined;
    return decision === DECISION_VALUES.DENY || decision === 'deny';
  });
  const target = deny ?? checks[0];
  if (!target) return '';
  const checkId = 'checkId' in target ? target.checkId : target.id;
  const message = target.message ?? '';
  if (checkId && message) return `[${String(checkId)}] ${message}`;
  return message || String(checkId ?? '');
}

export function buildGateBlockedReason(input: GateBlockedNotifyInput): string {
  const checkSummary = summarizeChecks(input.checks);
  if (checkSummary && input.reason) {
    return `${input.reason}\n${checkSummary}`.slice(0, 1500);
  }
  return (input.reason || checkSummary).slice(0, 1500);
}

export function shouldNotifyGateBlocked(hook: string, cwd: string = process.cwd()): boolean {
  const settings = getOnBlockedNotificationSettings(cwd);
  if (!settings.enabled) return false;
  if (settings.excludeHooks.has(hook)) return false;
  return true;
}

export function notifyGateBlockedAsync(input: GateBlockedNotifyInput): void {
  const cwd = input.cwd ?? process.cwd();
  if (!shouldNotifyGateBlocked(input.hook, cwd)) return;
  notifySecurityEventAsync({
    hook: input.hook,
    severity: input.severity ?? 'high',
    reason: buildGateBlockedReason(input),
    cwd,
    ...(input.session_id !== undefined ? { session_id: input.session_id } : {}),
  });
}

export { DEFAULT_EXCLUDE_HOOKS };
