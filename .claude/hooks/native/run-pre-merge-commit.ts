#!/usr/bin/env bun
/**
 * Native pre-merge-commit hook runner
 */

import { execCommand } from '../security-orchestrator.js';
import { runQualityGate, logGateResult } from '../quality-gate.js';
import { setPendingGateFailure } from '../gate-pending.js';
import { getIndexTreeSha, recordFullPass } from '../gate-cache.js';
import { exitIfQualityGateExcluded } from './native-common.js';

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

  const gateResult = await runQualityGate({ profile: 'full', cwd });
  logGateResult(HOOK_NAME, gateResult, { profile: 'full', cwd, hook: 'pre-merge-commit' });

  if (!gateResult.passed) {
    setPendingGateFailure('', {
      type: 'merge',
      command: 'git merge',
      cwd,
    });
    console.error(gateResult.decision.reason ?? 'pre-merge-commit quality gate failed');
    process.exit(1);
  }

  const indexTree = getIndexTreeSha(cwd);
  if (indexTree) {
    recordFullPass(cwd, indexTree);
  }

  process.exit(0);
}

void main();
