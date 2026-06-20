#!/usr/bin/env bun
/**
 * Native pre-commit hook runner
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { execCommand } from '../security-orchestrator.js';
import { runQualityGate, logGateResult } from '../quality-gate.js';

const HOOK_NAME = 'native-pre-commit';

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

  if (existsSync(join(cwd, '.git', 'MERGE_HEAD'))) {
    process.exit(0);
  }

  const gateResult = await runQualityGate({ profile: 'commit', cwd });
  logGateResult(HOOK_NAME, gateResult, { profile: 'commit', cwd });

  if (!gateResult.passed) {
    console.error(gateResult.decision.reason || 'pre-commit quality gate failed');
    process.exit(1);
  }

  process.exit(0);
}

main();
