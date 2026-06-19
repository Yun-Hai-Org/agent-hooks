#!/usr/bin/env bun
/**
 * Gate Retry Stop - Stop hook
 * 人工发起 git push / git merge 被 gate 拒绝后，若 Agent 尝试结束本轮，
 * 则 block/followup 驱动修复，直到 full 检查通过（不自动执行 push/merge）。
 *
 * 环境变量：
 *   GATE_RETRY_STOP=0        关闭
 *   GATE_RETRY_MAX_LOOPS=8   Cursor 最大 follow-up
 */

import { log } from './security-orchestrator.js';
import { runQualityGate } from './quality-gate.js';
import { parseStopInput } from './auto-commit.js';
import { getPendingGateFailure, clearPendingGateFailure } from './gate-pending.js';
import { buildGateRetryStopMessage, buildGateRetryPassMessage } from './gate-fix.js';
import { runFullOnSourceBranch } from './merge-gate.js';
import {
  getPlatform,
  formatStopContinueOutput,
  formatStopSuccessOutput,
} from './hook-adapter.js';

const HOOK_NAME = 'gate-retry-stop';
const DEFAULT_MAX_LOOPS = 8;

const GATE_LABELS = { push: 'push-gate', merge: 'merge-gate' };

export function isGateRetryStopEnabled() {
  const v = (process.env.GATE_RETRY_STOP ?? '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

export function getMaxGateRetryLoops() {
  const n = parseInt(process.env.GATE_RETRY_MAX_LOOPS || String(DEFAULT_MAX_LOOPS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_LOOPS;
}

/**
 * @param {import('./gate-pending.js').GatePendingEntry} pending
 */
export async function rerunPendingGate(pending) {
  if (pending.type === 'push') {
    return runQualityGate({ profile: 'full', cwd: pending.cwd });
  }
  if (pending.type === 'merge' && pending.sourceBranch) {
    return runFullOnSourceBranch(pending.cwd, pending.sourceBranch);
  }
  return {
    passed: false,
    results: [],
    decision: { reason: 'invalid pending merge entry' },
  };
}

/**
 * @param {string} sessionId
 * @param {{ loopCount?: number }} [options]
 */
export async function runGateRetryStop(sessionId, options = {}) {
  if (!isGateRetryStopEnabled()) {
    return { action: 'skip', reason: 'GATE_RETRY_STOP disabled' };
  }

  const pending = getPendingGateFailure(sessionId);
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
    };
  }

  clearPendingGateFailure(sessionId);
  return {
    action: 'pass',
    gateName,
    command: pending.command,
  };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = input.trim() ? JSON.parse(input) : {};
    const { sessionId, hookEvent, loopCount, status } = parseStopInput(data);
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
      log(HOOK_NAME, { level: 'SKIP', reason: `loop_limit ${maxLoops}`, session_id: sessionId });
      console.error(`[gate-retry] 已达最大重试次数 (${maxLoops})，请手动修复后重新 push/merge`);
      console.log('{}');
      return;
    }

    const result = await runGateRetryStop(sessionId, { loopCount });

    if (result.action === 'block' && result.gateResult) {
      const followup = buildGateRetryStopMessage(result.gateName, result.command, result.gateResult, {
        loopCount,
      });
      log(HOOK_NAME, { level: 'BLOCKED', gate: result.gateName, session_id: sessionId });
      console.log(formatStopContinueOutput(followup, hookEvent));
      return;
    }

    if (result.action === 'pass') {
      log(HOOK_NAME, { level: 'PASSED', gate: result.gateName, session_id: sessionId });
      console.log(
        formatStopSuccessOutput(buildGateRetryPassMessage(result.gateName, result.command), hookEvent),
      );
      return;
    }

    console.log('{}');
  } catch (e) {
    log(HOOK_NAME, { level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    console.log('{}');
  }
}

const isDirectRun = import.meta.main || (process.argv[1] && import.meta.url.endsWith(process.argv[1]));
if (isDirectRun) {
  main();
}

export { main };
