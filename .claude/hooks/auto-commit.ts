#!/usr/bin/env bun
/**
 * Auto Commit - Stop hook
 *
 * AUTO_COMMIT_MODE=agent（默认）：Stop 时检查工作区；有未提交变更 → block，要求 Agent 自行 git commit（native pre-commit 校验）
 * AUTO_COMMIT_MODE=auto：有暂存变更时 hook 自动 git commit（quality-gate profile=commit → git commit）
 *
 * 环境变量：
 *   AUTO_COMMIT=0           关闭 Stop 侧 commit 检查/自动提交
 *   AUTO_COMMIT_MODE        agent（默认）| auto
 *   AUTO_COMMIT_MESSAGE     auto 模式固定 commit message（需符合 feat: 格式）
 *   AUTO_COMMIT_SUBAGENT=1  允许 SubagentStop 时检查/提交（默认跳过）
 *   AUTO_COMMIT_MAX_LOOPS=8 Cursor stop 最大自动 follow-up 次数（默认 8）
 */

import { execCommand, log, getCurrentBranch } from './security-orchestrator.js';
import { getStagedFiles, hasUncommittedChanges, buildUncommittedWorktreeDenyReason } from './checks/git-policy.js';
import { summarizeResults } from './quality-gate.js';
import type { CheckResult } from './types.js';
import { asString } from './types.js';
import { getPlatform, formatStopContinueOutput, formatStopSuccessOutput } from './hook-adapter.js';
import { isGateNodeEnabled } from './gate-config.js';
import { buildShipStopDenyReason, loadWorkflowState, needsShipBeforeStop } from './workflow-state.js';
import { notifyGateBlockedAsync } from './gate-blocked-notify.js';

const HOOK_NAME = 'auto-commit';
const MAIN_BRANCHES = ['main', 'master'];
const DEFAULT_MAX_LOOPS = 8;

/** @param {Record<string, unknown>} data */
function resolveCwd(data: Record<string, unknown>): string {
  if (typeof data['cwd'] === 'string' && data['cwd']) return data['cwd'];
  const roots = data['workspace_roots'];
  if (Array.isArray(roots) && typeof roots[0] === 'string') return roots[0];
  return process.cwd();
}

export function parseStopInput(data: Record<string, unknown>) {
  return {
    cwd: resolveCwd(data),
    sessionId: asString(data['session_id']) || asString(data['conversation_id']),
    hookEvent: typeof data['hook_event_name'] === 'string' ? data['hook_event_name'] : '',
    stopHookActive: data['stop_hook_active'] === true,
    loopCount: typeof data['loop_count'] === 'number' ? data['loop_count'] : 0,
    status: typeof data['status'] === 'string' ? data['status'] : 'completed',
  };
}

/**
 *
 */
export function isAutoCommitEnabled() {
  const v = (process.env['AUTO_COMMIT'] ?? '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/** @returns {'agent' | 'auto'} */
export function getAutoCommitMode() {
  const mode = (process.env['AUTO_COMMIT_MODE'] ?? 'agent').toLowerCase();
  return mode === 'auto' ? 'auto' : 'agent';
}

/**
 *
 */
export function getMaxAutoCommitLoops() {
  const n = parseInt(process.env['AUTO_COMMIT_MAX_LOOPS'] ?? String(DEFAULT_MAX_LOOPS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_LOOPS;
}

export function hasStagedChanges(cwd: string) {
  const result = execCommand('git diff --cached --quiet', { cwd });
  return !result.success;
}

export function buildAgentCommitMessage(cwd: string) {
  return buildUncommittedWorktreeDenyReason(cwd, 'stop', { prefix: '[auto-commit] ' });
}

export function buildCommitMessage(stagedFiles: string[]) {
  const custom = process.env['AUTO_COMMIT_MESSAGE']?.trim();
  if (custom) return custom;

  const allTest = stagedFiles.every((f) => /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(f) || f.includes('__tests__'));
  const allDocs = stagedFiles.every((f) => /\.(md|mdx)$/.test(f));
  const allChore = stagedFiles.every((f) => /(?:lock|lockb|json|yaml|yml)$/.test(f.split('/').pop() ?? ''));

  let type = 'feat';
  if (allTest) type = 'test';
  else if (allDocs) type = 'docs';
  else if (allChore) type = 'chore';

  const names =
    stagedFiles.length <= 3
      ? stagedFiles.map((f) => f.split('/').pop()).join(', ')
      : `${String(stagedFiles.length)} files`;

  return `${type}: auto-commit ${names}`.slice(0, 200);
}

/**
 * @param {{ results: { checkId: string; decision: string; message: string }[]; decision?: { reason?: string } }} gateResult
 * @param {{ loopCount?: number }} [options]
 */
export function buildFixFollowupMessage(
  gateResult: { results: CheckResult[]; decision?: { reason?: string } },
  options: { loopCount?: number } = {},
) {
  const denied = gateResult.results.filter((r) => r.decision === 'deny');
  const summary = summarizeResults(denied.length > 0 ? denied : gateResult.results);
  const loopHint =
    typeof options.loopCount === 'number' && options.loopCount > 0
      ? `\n（第 ${String(options.loopCount + 1)} 次自动重试）`
      : '';

  return [
    `[auto-commit] 提交门未通过，请修复以下问题后结束本轮（会自动重新检查并提交）${loopHint}`,
    '',
    summary,
    '',
    '修复步骤：',
    '1. 根据上述 ❌ 项修复代码/测试/依赖',
    '2. 保存修改（auto-stage 会自动 git add）',
    '3. 结束本轮 — hook 将再次运行 commit 检查，通过后自动提交',
  ]
    .join('\n')
    .slice(0, 9500);
}

export function buildCommitFailureMessage(stderr: string) {
  return ['[auto-commit] git commit 执行失败，请修复后结束本轮重试：', '', stderr.trim().slice(0, 4000)].join('\n');
}

/**
 * @param {string} cwd
 * @param {{ sessionId?: string }} [options]
 */
export function runAutoCommit(cwd: string, options: { sessionId?: string } = {}) {
  if (!isAutoCommitEnabled()) {
    return { committed: false, reason: 'AUTO_COMMIT disabled' };
  }

  if (!execCommand('git rev-parse --git-dir', { cwd }).success) {
    return { committed: false, reason: 'not a git repo' };
  }

  const branch = getCurrentBranch(cwd);
  if (!branch) {
    return { committed: false, reason: 'cannot detect branch' };
  }
  if (MAIN_BRANCHES.includes(branch)) {
    return { committed: false, reason: `blocked on ${branch}` };
  }

  if (!hasStagedChanges(cwd)) {
    return { committed: false, reason: 'no staged changes' };
  }

  const stagedFiles = getStagedFiles(cwd);
  const message = buildCommitMessage(stagedFiles);
  const commitCmd = `git commit -m "${message.replace(/"/g, '\\"')}"`;

  const commitResult = execCommand(commitCmd, { cwd, timeout: 120000 });
  if (!commitResult.success) {
    const errText = commitResult.stderr || commitResult.stdout || 'unknown error';
    log(HOOK_NAME, {
      level: 'ERROR',
      branch,
      message,
      stderr: errText.slice(0, 500),
      session_id: options.sessionId,
      cwd,
    });
    return {
      committed: false,
      reason: errText,
      commitFailed: true,
      gateFailed: /pre-commit|commit-msg|quality gate|hook/i.test(errText),
    };
  }

  const sha = execCommand('git rev-parse --short HEAD', { cwd }).stdout.trim();
  log(HOOK_NAME, {
    level: 'COMMITTED',
    branch,
    message,
    sha,
    files: stagedFiles.length,
    session_id: options.sessionId,
    cwd,
  });
  return { committed: true, message, sha };
}

/**
 *
 */
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += typeof chunk === 'string' ? chunk : String(chunk);

  try {
    const data = input.trim() ? (JSON.parse(input) as Record<string, unknown>) : {};
    const { cwd, sessionId, hookEvent, loopCount, status } = parseStopInput(data);
    const platform = getPlatform();

    if (!isGateNodeEnabled('ide.auto-commit', cwd)) {
      log(HOOK_NAME, { level: 'SKIP', reason: 'gate disabled', session_id: sessionId, cwd });
      console.log('{}');
      return;
    }

    if (platform === 'cursor' && status !== 'completed') {
      log(HOOK_NAME, { level: 'SKIP', reason: `status=${status}`, session_id: sessionId, cwd });
      console.log('{}');
      return;
    }

    const maxLoops = getMaxAutoCommitLoops();
    if (platform === 'cursor' && loopCount >= maxLoops) {
      log(HOOK_NAME, {
        level: 'SKIP',
        reason: `loop_limit ${String(maxLoops)}`,
        loop_count: loopCount,
        session_id: sessionId,
        cwd,
      });
      console.error(`[auto-commit] 已达最大重试次数 (${String(maxLoops)})，请手动修复后提交`);
      console.log('{}');
      return;
    }

    if (hookEvent === 'SubagentStop' && process.env['AUTO_COMMIT_SUBAGENT'] !== '1') {
      log(HOOK_NAME, { level: 'SKIP', reason: 'SubagentStop', session_id: sessionId, cwd });
      console.log('{}');
      return;
    }

    if (!isAutoCommitEnabled()) {
      log(HOOK_NAME, { level: 'SKIP', reason: 'AUTO_COMMIT disabled', session_id: sessionId, cwd });
      console.log('{}');
      return;
    }

    if (!execCommand('git rev-parse --git-dir', { cwd }).success) {
      log(HOOK_NAME, { level: 'SKIP', reason: 'not a git repo', session_id: sessionId, cwd });
      console.log('{}');
      return;
    }

    const workflowState = loadWorkflowState(sessionId);
    if (needsShipBeforeStop(workflowState)) {
      const followup = buildShipStopDenyReason(workflowState);
      log(HOOK_NAME, {
        level: 'BLOCKED',
        reason: 'ship incomplete',
        ship_status: workflowState.ship_status,
        session_id: sessionId,
        cwd,
      });
      notifyGateBlockedAsync({
        hook: HOOK_NAME,
        reason: 'ship incomplete',
        cwd,
        session_id: sessionId,
      });
      process.stdout.write(`${formatStopContinueOutput(followup, hookEvent)}\n`);
      return;
    }

    if (getAutoCommitMode() === 'agent') {
      if (hasUncommittedChanges(cwd)) {
        const followup = buildAgentCommitMessage(cwd);
        log(HOOK_NAME, {
          level: 'BLOCKED',
          reason: 'uncommitted changes',
          mode: 'agent',
          session_id: sessionId,
          cwd,
        });
        notifyGateBlockedAsync({
          hook: HOOK_NAME,
          reason: 'uncommitted changes',
          cwd,
          session_id: sessionId,
        });
        console.log(formatStopContinueOutput(followup, hookEvent));
        return;
      }
      console.log('{}');
      return;
    }

    const result = runAutoCommit(cwd, { sessionId });

    if (result.committed) {
      console.log(
        formatStopSuccessOutput(`[auto-commit] 已提交 ${result.sha ?? ''}: ${result.message ?? ''}`, hookEvent),
      );
      return;
    }

    if (result.gateFailed && result.reason) {
      const followup = buildCommitFailureMessage(result.reason);
      console.log(formatStopContinueOutput(followup, hookEvent));
      return;
    }

    if (result.commitFailed && result.reason) {
      console.log(formatStopContinueOutput(buildCommitFailureMessage(result.reason), hookEvent));
      return;
    }

    if (hasUncommittedChanges(cwd)) {
      const followup = buildAgentCommitMessage(cwd);
      log(HOOK_NAME, {
        level: 'BLOCKED',
        reason: result.reason ?? 'uncommitted changes',
        mode: 'auto',
        session_id: sessionId,
        cwd,
      });
      notifyGateBlockedAsync({
        hook: HOOK_NAME,
        reason: result.reason ?? 'uncommitted changes',
        cwd,
        session_id: sessionId,
      });
      console.log(formatStopContinueOutput(followup, hookEvent));
      return;
    }

    if (result.reason) {
      log(HOOK_NAME, { level: 'SKIP', reason: result.reason, session_id: sessionId, cwd });
    }

    console.log('{}');
  } catch (e) {
    log(HOOK_NAME, { level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    console.log('{}');
  }
}

if (import.meta.main) {
  void main();
}

export { main, hasUncommittedChanges };
