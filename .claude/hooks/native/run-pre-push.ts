#!/usr/bin/env bun
/**
 * Native pre-push hook runner
 */

import { execCommand, log } from '../security-orchestrator.js';
import { hasUncommittedChanges, buildUncommittedWorktreeDenyReason } from '../checks/git-policy.js';
import { runQualityGate, logGateResult } from '../quality-gate.js';
import { setPendingGateFailure } from '../gate-pending.js';
import { getHeadTreeSha, hasFreshFullPass, recordFullPass } from '../gate-cache.js';
import { exitIfQualityGateExcluded, exitIfGateHookDisabled } from './native-common.js';

const HOOK_NAME = 'native-pre-push';

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
  exitIfGateHookDisabled(HOOK_NAME, 'git.pre-push', cwd);

  if (hasUncommittedChanges(cwd)) {
    console.error(buildUncommittedWorktreeDenyReason(cwd, 'push'));
    process.exit(1);
  }

  const headTree = getHeadTreeSha(cwd);
  if (headTree && hasFreshFullPass(cwd, headTree)) {
    log(HOOK_NAME, { level: 'SKIP', reason: 'full 门已在相同提交树通过，跳过重复扫描', tree: headTree, cwd });
    process.exit(0);
  }

  const gateResult = await runQualityGate({ profile: 'full', cwd });
  logGateResult(HOOK_NAME, gateResult, { profile: 'full', cwd });

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

  process.exit(0);
}

if (import.meta.main) {
  void main();
}
