#!/usr/bin/env bun
/**
 * Push Gate - PreToolUse Hook for Bash
 * 推送门：git push 前跑 quality-gate --profile=full
 */

import { safeMain, log, getCurrentBranch, DECISION } from './security-orchestrator.js';
import { readHookInput, formatDenyOutput, formatAllowOutput, isShellHookInput } from './hook-adapter.js';
import { isGitPushCommand, hasUncommittedChanges, buildUncommittedWorktreeDenyReason } from './checks/git-policy.js';
import {
  describePushMergeBranchSkip,
  resolvePushMergeBranchPolicyForCwd,
  shouldRunFullGateForBranch,
} from './checks/branch-policy.js';
import { runQualityGate, logGateResult } from './quality-gate.js';
import { buildGateDenyReason } from './gate-fix.js';
import { setPendingGateFailure, clearPendingGateFailure } from './gate-pending.js';

const HOOK_NAME = 'push-gate';

/** 测试注入容器（默认调用 runQualityGate） */
export const pushGateDeps = { runQualityGate };

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
    const branchPolicy = resolvePushMergeBranchPolicyForCwd(workingDir);
    if (!shouldRunFullGateForBranch(branch ?? '', branchPolicy)) {
      log(HOOK_NAME, {
        level: 'SKIP',
        reason: describePushMergeBranchSkip(branchPolicy, [branch ?? '']),
        branch,
        session_id,
        cwd: workingDir,
      });
      process.stdout.write(`${formatAllowOutput()}\n`);
      return;
    }

    if (hasUncommittedChanges(workingDir)) {
      console.log(formatDenyOutput(DECISION.DENY, buildUncommittedWorktreeDenyReason(workingDir, 'push')));
      return;
    }

    const gateResult = await pushGateDeps.runQualityGate({ profile: 'full', cwd: workingDir });

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
