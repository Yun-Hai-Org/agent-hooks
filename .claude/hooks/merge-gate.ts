#!/usr/bin/env bun
/**
 * Merge Gate - PreToolUse Hook for Bash
 * 合并门：git merge 到 main/master 前对 source 分支跑 quality-gate --profile=full
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execCommand, safeMain, log, getCurrentBranch, DECISION } from './security-orchestrator.js';
import { readHookInput, formatDenyOutput, formatAllowOutput, isShellHookInput } from './hook-adapter.js';
import {
  extractMergeTarget,
  isGitMergeCommand,
  hasUncommittedChanges,
  buildUncommittedWorktreeDenyReason,
} from './checks/git-policy.js';
import { runQualityGate, logGateResult } from './quality-gate.js';
import { buildGateDenyReason } from './gate-fix.js';
import { setPendingGateFailure, clearPendingGateFailure } from './gate-pending.js';

const HOOK_NAME = 'merge-gate';

async function runFullOnSourceBranch(repoCwd: string, sourceBranch: string) {
  const worktreeDir = mkdtempSync(join(tmpdir(), 'merge-gate-'));
  try {
    const addResult = execCommand(`git worktree add "${worktreeDir}" "${sourceBranch}"`, {
      cwd: repoCwd,
      timeout: 60000,
    });
    if (!addResult.success) {
      return {
        passed: false,
        decision: { decision: DECISION.DENY, reason: `无法 checkout source 分支 ${sourceBranch}: ${addResult.stderr}` },
        results: [],
      };
    }
    return await runQualityGate({ profile: 'full', cwd: worktreeDir });
  } finally {
    execCommand(`git worktree remove --force "${worktreeDir}"`, { cwd: repoCwd, timeout: 30000 });
    try {
      rmSync(worktreeDir, { recursive: true, force: true });
    } catch {}
  }
}

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

    const cmd = tool_input?.command || '';
    if (!isGitMergeCommand(cmd)) {
      console.log(formatAllowOutput());
      return;
    }

    const currentBranch = getCurrentBranch(workingDir);
    if (currentBranch !== 'main' && currentBranch !== 'master') {
      log(HOOK_NAME, {
        level: 'SKIP',
        reason: `当前分支 ${currentBranch} 非 main/master`,
        session_id,
        cwd: workingDir,
      });
      console.log(formatAllowOutput());
      return;
    }

    const sourceBranch = extractMergeTarget(cmd);
    if (!sourceBranch) {
      console.log(formatDenyOutput(DECISION.DENY, '无法解析 git merge 的 source 分支'));
      return;
    }

    if (sourceBranch === 'main' || sourceBranch === 'master') {
      console.log(formatDenyOutput(DECISION.DENY, '禁止 merge main/master 到自身'));
      return;
    }

    if (hasUncommittedChanges(workingDir)) {
      console.log(formatDenyOutput(DECISION.DENY, buildUncommittedWorktreeDenyReason(workingDir, 'merge')));
      return;
    }

    execCommand('git fetch --quiet', { cwd: workingDir, timeout: 60000 });

    const gateResult = await runFullOnSourceBranch(workingDir, sourceBranch);

    logGateResult(HOOK_NAME, gateResult, {
      profile: 'full',
      sourceBranch,
      session_id,
      cwd: workingDir,
    });

    if (!gateResult.passed) {
      const reason = buildGateDenyReason(HOOK_NAME, cmd, gateResult);
      setPendingGateFailure(session_id, {
        type: 'merge',
        command: cmd,
        cwd: workingDir,
        sourceBranch,
      });
      console.log(formatDenyOutput(DECISION.DENY, reason));
      return;
    }

    clearPendingGateFailure(session_id);

    console.log(formatAllowOutput());
  });
}

if (import.meta.main) {
  main();
}

export { extractMergeTarget, getCurrentBranch, runFullOnSourceBranch, main };
