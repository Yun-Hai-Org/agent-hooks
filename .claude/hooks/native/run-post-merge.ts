#!/usr/bin/env bun
/**
 * Native post-merge hook runner
 */

import { handleGitOperationNotify } from '../git-operation-notify.js';
import { execCommand } from '../security-orchestrator.js';
import { exitIfQualityGateExcluded } from './native-common.js';

const HOOK_NAME = 'native-post-merge';

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

  try {
    await handleGitOperationNotify('merge', cwd);
  } catch {
    // fail-open
  }
  process.exit(0);
}

if (import.meta.main) {
  void main();
}
