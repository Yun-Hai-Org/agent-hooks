#!/usr/bin/env bun
/**
 * Native post-commit hook runner
 */

import { handleGitOperationNotify, isMergeCommit } from '../git-operation-notify.js';
import { execCommand, log } from '../security-orchestrator.js';
import { exitIfQualityGateExcluded } from './native-common.js';

const HOOK_NAME = 'native-post-commit';

function getRepoRoot() {
  const result = execCommand('git rev-parse --show-toplevel');
  if (!result.success || !result.stdout.trim()) {
    process.exit(0);
  }
  return result.stdout.trim();
}

async function main() {
  const cwd = getRepoRoot();
  exitIfQualityGateExcluded(HOOK_NAME, cwd);

  if (isMergeCommit(cwd)) {
    log(HOOK_NAME, { level: 'SKIP', reason: 'merge commit 由 post-merge 通知', cwd });
    process.exit(0);
  }

  try {
    await handleGitOperationNotify('commit', cwd);
  } catch {
    // fail-open
  }
  process.exit(0);
}

if (import.meta.main) {
  void main();
}
