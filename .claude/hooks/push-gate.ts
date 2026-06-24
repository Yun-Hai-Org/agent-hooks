#!/usr/bin/env bun
/**
 * Push Gate - PreToolUse Hook for Bash
 * 推送门：git push 前跑 quality-gate --profile=full
 */

import { safeMain, getCurrentBranch, DECISION } from './security-orchestrator.js';
import { readHookInput, formatDenyOutput, formatAllowOutput, isShellHookInput } from './hook-adapter.js';
import { isGitPushCommand, hasUncommittedChanges, buildUncommittedWorktreeDenyReason } from './checks/git-policy.js';
import { runQualityGate, logGateResult } from './quality-gate.js';
import { buildGateDenyReason } from './gate-fix.js';
import { setPendingGateFailure, clearPendingGateFailure } from './gate-pending.js';

const HOOK_NAME = 'push-gate';

/**
 *
 */
async function main() {
  await safeMain(async () => {
    const data = await readHookInput();
    const { tool_input, session_id, cwd } = data;
    const workingDir = cwd || process.cwd();

    if (!isShellHookInput(data)) {
      console.log(formatAllowOutput());
      return;
    }

    const cmd = tool_input.command ?? '';
    if (!isGitPushCommand(cmd)) {
      console.log(formatAllowOutput());
      return;
    }

    const branch = getCurrentBranch(workingDir);

    if (hasUncommittedChanges(workingDir)) {
      console.log(formatDenyOutput(DECISION.DENY, buildUncommittedWorktreeDenyReason(workingDir, 'push')));
      return;
    }

    const gateResult = await runQualityGate({ profile: 'full', cwd: workingDir });

    logGateResult(HOOK_NAME, gateResult, {
      profile: 'full',
      branch,
      session_id,
      cwd: workingDir,
    });

    if (!gateResult.passed) {
      setPendingGateFailure(session_id, { type: 'push', command: cmd, cwd: workingDir });
      const reason = buildGateDenyReason(HOOK_NAME, cmd, gateResult);
      console.log(formatDenyOutput(DECISION.DENY, reason));
      return;
    }

    clearPendingGateFailure(session_id);

    console.log(formatAllowOutput());
  });
}

if (import.meta.main) {
  void main();
}

export { main };
