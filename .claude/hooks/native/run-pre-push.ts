#!/usr/bin/env bun
/**
 * Native pre-push hook runner
 */

import { readFileSync } from 'fs';
import { execCommand, log, getCurrentBranch } from '../security-orchestrator.js';
import { hasUncommittedChanges, buildUncommittedWorktreeDenyReason } from '../checks/git-policy.js';
import {
  describePushMergeBranchSkip,
  parsePrePushLocalBranches,
  resolvePushMergeBranchPolicyForCwd,
  shouldRunFullGateForBranches,
} from '../checks/branch-policy.js';
import { runQualityGate, logGateResult } from '../quality-gate.js';
import { setPendingGateFailure } from '../gate-pending.js';
import { getHeadTreeSha, hasFreshFullPass, recordFullPass } from '../gate-cache.js';
import { exitIfQualityGateExcluded, exitIfGateHookDisabled } from './native-common.js';
import { handleGitOperationNotify } from '../git-operation-notify.js';

const HOOK_NAME = 'native-pre-push';

async function notifyPushSuccess(cwd: string) {
  try {
    await handleGitOperationNotify('push', cwd);
  } catch {
    // fail-open
  }
}

function getRepoRoot() {
  const result = execCommand('git rev-parse --show-toplevel');
  if (!result.success || !result.stdout.trim()) {
    console.error(`[${HOOK_NAME}] 无法确定 git 仓库根目录`);
    process.exit(1);
  }
  return result.stdout.trim();
}

function readPrePushBranchNames(cwd: string): string[] {
  try {
    const raw = readFileSync(0, 'utf-8');
    const fromStdin = parsePrePushLocalBranches(raw.split('\n'));
    if (fromStdin.length > 0) return fromStdin;
  } catch {
    // stdin unavailable in some runners
  }
  const current = getCurrentBranch(cwd);
  return current ? [current] : [];
}

async function main() {
  const cwd = getRepoRoot();
  exitIfQualityGateExcluded(HOOK_NAME, cwd);
  exitIfGateHookDisabled(HOOK_NAME, 'git.pre-push', cwd);

  const branchPolicy = resolvePushMergeBranchPolicyForCwd(cwd);
  const pushBranches = readPrePushBranchNames(cwd);
  if (!shouldRunFullGateForBranches(pushBranches, branchPolicy)) {
    log(HOOK_NAME, {
      level: 'SKIP',
      reason: describePushMergeBranchSkip(branchPolicy, pushBranches),
      branches: pushBranches,
      cwd,
    });
    process.exit(0);
  }

  if (hasUncommittedChanges(cwd)) {
    console.error(buildUncommittedWorktreeDenyReason(cwd, 'push'));
    process.exit(1);
  }

  const headTree = getHeadTreeSha(cwd);
  if (headTree && hasFreshFullPass(cwd, headTree)) {
    log(HOOK_NAME, { level: 'SKIP', reason: 'full 门已在相同提交树通过，跳过重复扫描', tree: headTree, cwd });
    await notifyPushSuccess(cwd);
    process.exit(0);
  }

  const gateResult = await runQualityGate({ profile: 'full', cwd });
  logGateResult(HOOK_NAME, gateResult, { profile: 'full', cwd, branches: pushBranches });

  if (!gateResult.passed) {
    setPendingGateFailure('', {
      type: 'push',
      command: 'git push',
      cwd,
    });
    console.error(gateResult.decision.reason ?? 'pre-push quality gate failed');
    process.exit(1);
  }

  if (headTree) {
    recordFullPass(cwd, headTree);
  }

  await notifyPushSuccess(cwd);
  process.exit(0);
}

if (import.meta.main) {
  void main();
}
