#!/usr/bin/env bun
/**
 * Git Operation Notify - commit / push / merge 成功 webhook 通知
 */

import { basename } from 'path';
import { getGitOperationNotifyConfig, type GitOperationKind } from './gate-config.js';
import { getPlatform, platformLabel } from './hook-adapter.js';
import { dispatchGitOperationNotification } from './notification-core.js';
import { execCommand, getCurrentBranch, log } from './security-orchestrator.js';

const HOOK_NAME = 'git-operation-notify';

function resolveProjectName(cwd: string): string {
  const result = execCommand('git rev-parse --show-toplevel', { cwd });
  const root = result.success ? result.stdout.trim() : cwd;
  return basename(root) || 'project';
}

function resolvePlatformLabel(): string {
  return platformLabel(getPlatform());
}

function getHeadSha(cwd: string): string {
  const result = execCommand('git rev-parse HEAD', { cwd });
  return result.success ? result.stdout.trim() : '';
}

function getCommitSubject(cwd: string): string {
  const result = execCommand('git log -1 --pretty=%s', { cwd });
  return result.success ? result.stdout.trim() : '';
}

export function isMergeCommit(cwd: string): boolean {
  const result = execCommand('git rev-list --parents -n 1 HEAD', { cwd });
  if (!result.success) return false;
  return result.stdout.trim().split(/\s+/).length > 2;
}

function buildSummaryText(operation: GitOperationKind, cwd: string, branch: string): string {
  const subject = getCommitSubject(cwd);
  switch (operation) {
    case 'commit':
      return subject || '提交已完成';
    case 'push':
      return `分支 ${branch} 已通过 pre-push 质量门，即将推送。`;
    case 'merge':
      return subject ? `合并完成：${subject}` : '合并已完成';
    default: {
      const _exhaustive: never = operation;
      return _exhaustive;
    }
  }
}

export async function handleGitOperationNotify(operation: GitOperationKind, cwd: string) {
  const config = getGitOperationNotifyConfig(cwd);
  if (!config.enabled) {
    return { sent: false, reason: 'gate disabled' };
  }
  if (!config.operations.includes(operation)) {
    log(HOOK_NAME, { level: 'SKIP', reason: 'operation_filtered', operation, cwd });
    return { sent: false, reason: 'operation_filtered' };
  }

  const branch = getCurrentBranch(cwd) ?? 'unknown';
  const commitSha = getHeadSha(cwd);
  return dispatchGitOperationNotification(
    {
      operation,
      projectName: resolveProjectName(cwd),
      platform: resolvePlatformLabel(),
      branch,
      summaryText: buildSummaryText(operation, cwd, branch),
      ...(commitSha ? { commitSha } : {}),
    },
    cwd,
    { maxSummaryChars: config.maxSummaryChars, timeoutMs: config.timeoutMs },
    HOOK_NAME,
  );
}

export { HOOK_NAME };
