#!/usr/bin/env bun
/**
 * Gate Retry Stop - Stop hook
 * push/merge 被 native gate 拒绝后，Stop 时 block/followup 驱动修复
 */

import { log, execCommand } from './security-orchestrator.js';
import { runQualityGate } from './quality-gate.js';
import { parseStopInput } from './auto-commit.js';
import { getPendingGateFailure, clearPendingGateFailure } from './gate-pending.js';
import {
  buildGateRetryStopMessage,
  buildGateRetryPassMessage,
  buildGateRetryMergeSuccessMessage,
  buildGateRetryMergeFailureMessage,
} from './gate-fix.js';
import { getPlatform, formatStopContinueOutput, formatStopSuccessOutput } from './hook-adapter.js';
import type { GatePendingEntry } from './types.js';

const HOOK_NAME = 'gate-retry-stop';
const DEFAULT_MAX_LOOPS = 8;

const GATE_LABELS = /** @type {Record<string, string>} */ { push: 'pre-push', merge: 'pre-merge-commit' };

/**
 *
 */
export function isGateRetryStopEnabled() {
  const v = (process.env['GATE_RETRY_STOP'] ?? '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 *
 */
export function isAutoRetryMergeEnabled() {
  const v = (process.env['GATE_AUTO_RETRY_MERGE'] ?? '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 *
 */
export function getMaxGateRetryLoops() {
  const n = parseInt(process.env['GATE_RETRY_MAX_LOOPS'] ?? String(DEFAULT_MAX_LOOPS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_LOOPS;
}

export async function rerunPendingGate(pending: GatePendingEntry) {
  return runQualityGate({ profile: 'full', cwd: pending.cwd });
}

export function executePendingMerge(pending: GatePendingEntry) {
  return execCommand(pending.command, { cwd: pending.cwd, timeout: 120000 });
}

/**
 * @param {string} sessionId
 * @param {{ loopCount?: number; cwd?: string }} [options]
 */
export async function runGateRetryStop(sessionId: string, options: { cwd?: string; loopCount?: number } = {}) {
  if (!isGateRetryStopEnabled()) {
    return { action: 'skip', reason: 'GATE_RETRY_STOP disabled' };
  }

  const pending = getPendingGateFailure(sessionId, options.cwd);
  if (!pending) {
    return { action: 'skip', reason: 'no pending gate failure' };
  }

  const gateName = GATE_LABELS[pending.type] || pending.type;
  const gateResult = await rerunPendingGate(pending);

  if (!gateResult.passed) {
    return {
      action: 'block',
      gateName,
      command: pending.command,
      gateResult,
      pendingType: pending.type,
    };
  }

  clearPendingGateFailure(sessionId, pending.cwd);

  if (pending.type === 'merge' && isAutoRetryMergeEnabled()) {
    const mergeResult = executePendingMerge(pending);
    if (mergeResult.success) {
      const sha = execCommand('git rev-parse --short HEAD', { cwd: pending.cwd }).stdout.trim();
      return {
        action: 'merged',
        gateName,
        command: pending.command,
        mergeOutput: (mergeResult.stdout || mergeResult.stderr || '').trim(),
        sha,
      };
    }
    return {
      action: 'merge-failed',
      gateName,
      command: pending.command,
      mergeError: (mergeResult.stderr || mergeResult.stdout || 'merge failed').trim(),
    };
  }

  return {
    action: 'pass',
    gateName,
    command: pending.command,
    pendingType: pending.type,
  };
}

/**
 *
 */
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += typeof chunk === 'string' ? chunk : String(chunk);

  try {
    const data = input.trim() ? (JSON.parse(input) as Record<string, unknown>) : {};
    const { sessionId, hookEvent, loopCount, status, cwd } = parseStopInput(data);
    const platform = getPlatform();

    if (!isGateRetryStopEnabled()) {
      console.log('{}');
      return;
    }

    if (platform === 'cursor' && status !== 'completed') {
      console.log('{}');
      return;
    }

    const maxLoops = getMaxGateRetryLoops();
    if (platform === 'cursor' && loopCount >= maxLoops) {
      log(HOOK_NAME, { level: 'SKIP', reason: `loop_limit ${String(maxLoops)}`, session_id: sessionId });
      console.error(`[gate-retry] 已达最大重试次数 (${String(maxLoops)})，请手动修复后重新 push/merge`);
      console.log('{}');
      return;
    }

    const result = await runGateRetryStop(sessionId, { loopCount, cwd });

    if (result.action === 'block' && result.gateResult) {
      const followup = buildGateRetryStopMessage(result.gateName, result.command, result.gateResult, {
        loopCount,
        pendingType: result.pendingType,
      });
      log(HOOK_NAME, { level: 'BLOCKED', gate: result.gateName, session_id: sessionId });
      console.log(formatStopContinueOutput(followup, hookEvent));
      return;
    }

    if (result.action === 'merged') {
      const { gateName, command, sha } = result;
      log(HOOK_NAME, { level: 'MERGED', gate: gateName, sha, session_id: sessionId });
      console.log(
        formatStopSuccessOutput(buildGateRetryMergeSuccessMessage(gateName ?? '', command ?? '', sha), hookEvent),
      );
      return;
    }

    if (result.action === 'merge-failed') {
      const { gateName, command } = result;
      log(HOOK_NAME, { level: 'MERGE_FAILED', gate: gateName, session_id: sessionId });
      console.log(
        formatStopContinueOutput(buildGateRetryMergeFailureMessage(command ?? '', result.mergeError ?? ''), hookEvent),
      );
      return;
    }

    if (result.action === 'pass') {
      const { gateName, command } = result;
      log(HOOK_NAME, { level: 'PASSED', gate: gateName, session_id: sessionId });
      console.log(
        formatStopSuccessOutput(
          buildGateRetryPassMessage(gateName ?? '', command ?? '', result.pendingType),
          hookEvent,
        ),
      );
      return;
    }

    console.log('{}');
  } catch (e) {
    log(HOOK_NAME, { level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    console.log('{}');
  }
}

if (import.meta.main) {
  void main();
}

export { main };
