#!/usr/bin/env bun
/**
 * Native pre-commit hook runner
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { execCommand, log } from '../security-orchestrator.js';
import { runQualityGate, logGateResult } from '../quality-gate.js';
import { getIndexTreeSha, hasFreshFullPass, recordFullPass } from '../gate-cache.js';
import { clearPendingGateFailure } from '../gate-pending.js';
import { exitIfQualityGateExcluded, exitIfGateHookDisabled } from './native-common.js';

const HOOK_NAME = 'native-pre-commit';

export function isMergeConclude(cwd: string): boolean {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为 git 仓库根，拼接常量 MERGE_HEAD
  return existsSync(join(cwd, '.git', 'MERGE_HEAD'));
}

function getRepoRoot() {
  const result = execCommand('git rev-parse --show-toplevel');
  if (!result.success || !result.stdout.trim()) {
    console.error(`[${HOOK_NAME}] 无法确定 git 仓库根目录`);
    process.exit(1);
  }
  return result.stdout.trim();
}

async function runMergeConcludeGate(cwd: string): Promise<void> {
  const indexTree = getIndexTreeSha(cwd);
  if (indexTree && hasFreshFullPass(cwd, indexTree)) {
    log(HOOK_NAME, {
      level: 'SKIP',
      reason: 'full 门已在相同索引树通过，跳过 merge 结论重复扫描',
      tree: indexTree,
      cwd,
    });
    clearPendingGateFailure('', cwd);
    process.exit(0);
  }

  const gateResult = await runQualityGate({ profile: 'full', cwd });
  logGateResult(HOOK_NAME, gateResult, { profile: 'full', cwd, hook: 'merge-conclude' });

  if (!gateResult.passed) {
    console.error(gateResult.decision.reason ?? 'merge conclude quality gate failed');
    process.exit(1);
  }

  if (indexTree) {
    recordFullPass(cwd, indexTree);
  }
  clearPendingGateFailure('', cwd);
  process.exit(0);
}

async function main() {
  const cwd = getRepoRoot();
  exitIfQualityGateExcluded(HOOK_NAME, cwd);
  exitIfGateHookDisabled(HOOK_NAME, 'git.pre-commit', cwd);

  if (isMergeConclude(cwd)) {
    await runMergeConcludeGate(cwd);
    return;
  }

  const gateResult = await runQualityGate({ profile: 'commit', cwd });
  logGateResult(HOOK_NAME, gateResult, { profile: 'commit', cwd });

  if (!gateResult.passed) {
    console.error(gateResult.decision.reason ?? 'pre-commit quality gate failed');
    process.exit(1);
  }

  process.exit(0);
}

if (import.meta.main) {
  void main();
}
