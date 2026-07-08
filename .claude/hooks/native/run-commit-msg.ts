#!/usr/bin/env bun
/**
 * Native commit-msg hook runner — 仅校验 commit message 格式
 */

import { execCommand, log, DECISION } from '../security-orchestrator.js';
import { checkCommitMessageFromFile } from '../checks/git-policy.js';
import { exitIfQualityGateExcluded } from './native-common.js';
import { resolveGateNode } from '../gate-config.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { notifyGateBlockedAsync } from '../gate-blocked-notify.js';

const HOOK_NAME = 'native-commit-msg';

function getRepoRoot() {
  const result = execCommand('git rev-parse --show-toplevel');
  if (!result.success || !result.stdout.trim()) {
    console.error(`[${HOOK_NAME}] 无法确定 git 仓库根目录`);
    process.exit(1);
  }
  return result.stdout.trim();
}

function main() {
  const msgFile = process.argv[2];
  if (!msgFile) {
    console.error(`[${HOOK_NAME}] 用法: run-commit-msg.js <commit-msg-file>`);
    process.exit(1);
  }

  const cwd = getRepoRoot();
  exitIfQualityGateExcluded(HOOK_NAME, cwd);

  const commitMsgNode = resolveGateNode('git.commit-msg.checks.commit-msg', cwd);
  if (!commitMsgNode.configured || !commitMsgNode.enabled) {
    log(HOOK_NAME, { level: 'SKIP', reason: 'commit-msg 未在 quality-gate.yaml 中启用', cwd });
    process.exit(0);
  }

  if (existsSync(join(cwd, '.git', 'MERGE_HEAD'))) {
    log(HOOK_NAME, { level: 'PASSED', cwd, message: 'merge commit，跳过 message 格式校验' });
    process.exit(0);
  }

  const result = checkCommitMessageFromFile(msgFile);

  log(HOOK_NAME, {
    level: result.decision === DECISION.DENY ? 'BLOCKED' : 'PASSED',
    cwd,
    message: result.message,
  });

  if (result.decision === DECISION.DENY) {
    notifyGateBlockedAsync({
      hook: HOOK_NAME,
      reason: result.message,
      cwd,
    });
    console.error(result.message);
    process.exit(1);
  }

  process.exit(0);
}

if (import.meta.main) {
  main();
}
