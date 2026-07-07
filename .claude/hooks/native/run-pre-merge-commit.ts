#!/usr/bin/env bun
/**
 * Native pre-merge-commit hook runner
 */

import { execCommand, log, getCurrentBranch } from '../security-orchestrator.js';
import {
  describePushMergeBranchSkip,
  resolvePushMergeBranchPolicyForCwd,
  shouldRunFullGateForBranch,
} from '../checks/branch-policy.js';
import { isIntegratorMerge, resolveMergeHeadBranch } from '../checks/git-policy.js';
import { resolveWorktreeSettings } from '../gate-config.js';
import { runQualityGate, logGateResult } from '../quality-gate.js';
import { exportFullAuditBundle } from '../audit-export.js';
import { setPendingGateFailure, clearPendingGateFailure } from '../gate-pending.js';
import { getIndexTreeSha, hasFreshFullPass, recordFullPass } from '../gate-cache.js';
import { syncShipStatusFromNativeHook } from '../ship-status-sync.js';
import { exitIfQualityGateExcluded, exitIfGateHookDisabled } from './native-common.js';

const HOOK_NAME = 'native-pre-merge-commit';

function getRepoRoot() {
  const result = execCommand('git rev-parse --show-toplevel');
  if (!result.success || !result.stdout.trim()) {
    console.error(`[${HOOK_NAME}] 无法确定 git 仓库根目录`);
    process.exit(1);
  }
  return result.stdout.trim();
}

async function main() {
  const cwd = getRepoRoot();
  exitIfQualityGateExcluded(HOOK_NAME, cwd);
  exitIfGateHookDisabled(HOOK_NAME, 'git.pre-merge-commit', cwd);

  const branchPolicy = resolvePushMergeBranchPolicyForCwd(cwd);
  const currentBranch = getCurrentBranch(cwd) ?? '';
  const worktreeSettings = resolveWorktreeSettings(cwd);
  const mergeSourceBranch = resolveMergeHeadBranch(cwd);

  if (isIntegratorMerge(currentBranch, mergeSourceBranch) && !worktreeSettings.integratorMergeRequiresFull) {
    log(HOOK_NAME, {
      level: 'SKIP',
      reason: 'integrator merge skip full gate',
      source: mergeSourceBranch,
      branch: currentBranch,
      cwd,
    });
    process.exit(0);
  }

  if (!shouldRunFullGateForBranch(currentBranch, branchPolicy)) {
    log(HOOK_NAME, {
      level: 'SKIP',
      reason: describePushMergeBranchSkip(branchPolicy, [currentBranch]),
      branch: currentBranch,
      cwd,
    });
    process.exit(0);
  }

  const indexTree = getIndexTreeSha(cwd);
  if (indexTree && hasFreshFullPass(cwd, indexTree)) {
    log(HOOK_NAME, {
      level: 'SKIP',
      reason: 'full 门已在相同索引树通过，跳过 pre-merge-commit 重复扫描',
      tree: indexTree,
      cwd,
    });
    clearPendingGateFailure('', cwd);
    process.exit(0);
  }

  const gateResult = await runQualityGate({ profile: 'full', cwd, gatePathPrefix: 'git.pre-merge-commit' });
  logGateResult(HOOK_NAME, gateResult, { profile: 'full', cwd, hook: 'pre-merge-commit' });

  if (!gateResult.passed) {
    syncShipStatusFromNativeHook('failed', cwd, gateResult.decision.reason);
    setPendingGateFailure('', {
      type: 'merge',
      command: 'git merge',
      cwd,
    });
    console.error(gateResult.decision.reason ?? 'pre-merge-commit quality gate failed');
    process.exit(1);
  }

  const indexTreeAfter = getIndexTreeSha(cwd);
  if (indexTreeAfter) {
    recordFullPass(cwd, indexTreeAfter);
  }

  exportFullAuditBundle({
    hookName: HOOK_NAME,
    cwd,
    passed: true,
    results: gateResult.results,
    timing: gateResult.timing,
    gatePathPrefix: 'git.pre-merge-commit',
  });

  process.exit(0);
}

if (import.meta.main) {
  void main();
}
