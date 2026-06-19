#!/usr/bin/env bun
/**
 * Auto Commit - Stop hook
 * Agent 一轮结束后，若有暂存变更则在 feature 分支自动 git commit。
 *
 * 流程：quality-gate profile=commit → 通过则 git commit
 *       失败则 block（Claude）/ followup_message（Cursor）→ Agent 修复 → 再次 Stop 重试
 *
 * 环境变量：
 *   AUTO_COMMIT=0           关闭自动提交
 *   AUTO_COMMIT_MESSAGE     固定 commit message（需符合 feat: 格式）
 *   AUTO_COMMIT_SUBAGENT=1  允许 SubagentStop 时提交（默认跳过）
 *   AUTO_COMMIT_MAX_LOOPS=8 Cursor stop 最大自动 follow-up 次数（默认 8）
 */

import { execCommand, log, getCurrentBranch } from './security-orchestrator.js';
import { getStagedFiles } from './checks/git-policy.js';
import { runQualityGate, summarizeResults, formatChecksForLog } from './quality-gate.js';
import {
  getPlatform,
  formatStopContinueOutput,
  formatStopSuccessOutput,
} from './hook-adapter.js';

const HOOK_NAME = 'auto-commit';
const MAIN_BRANCHES = ['main', 'master'];
const DEFAULT_MAX_LOOPS = 8;

/** @param {Record<string, unknown>} data */
function resolveCwd(data) {
  if (typeof data.cwd === 'string' && data.cwd) return data.cwd;
  const roots = data.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === 'string') return roots[0];
  return process.cwd();
}

/** @param {Record<string, unknown>} data */
export function parseStopInput(data) {
  return {
    cwd: resolveCwd(data),
    sessionId: typeof data.session_id === 'string' ? data.session_id : '',
    hookEvent: typeof data.hook_event_name === 'string' ? data.hook_event_name : '',
    stopHookActive: data.stop_hook_active === true,
    loopCount: typeof data.loop_count === 'number' ? data.loop_count : 0,
    status: typeof data.status === 'string' ? data.status : 'completed',
  };
}

export function isAutoCommitEnabled() {
  const v = (process.env.AUTO_COMMIT ?? '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

export function getMaxAutoCommitLoops() {
  const n = parseInt(process.env.AUTO_COMMIT_MAX_LOOPS || String(DEFAULT_MAX_LOOPS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_LOOPS;
}

/** @param {string} cwd */
export function hasStagedChanges(cwd) {
  const result = execCommand('git diff --cached --quiet', { cwd });
  return !result.success;
}

/**
 * @param {string[]} stagedFiles
 * @returns {string}
 */
export function buildCommitMessage(stagedFiles) {
  const custom = process.env.AUTO_COMMIT_MESSAGE?.trim();
  if (custom) return custom;

  const allTest = stagedFiles.every((f) => /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(f) || f.includes('__tests__'));
  const allDocs = stagedFiles.every((f) => /\.(md|mdx)$/.test(f));
  const allChore = stagedFiles.every((f) => /(?:lock|lockb|json|yaml|yml)$/.test(f.split('/').pop() || ''));

  let type = 'feat';
  if (allTest) type = 'test';
  else if (allDocs) type = 'docs';
  else if (allChore) type = 'chore';

  const names =
    stagedFiles.length <= 3
      ? stagedFiles.map((f) => f.split('/').pop()).join(', ')
      : `${stagedFiles.length} files`;

  return `${type}: auto-commit ${names}`.slice(0, 200);
}

/**
 * @param {{ results: { checkId: string; decision: string; message: string }[]; decision?: { reason?: string } }} gateResult
 * @param {{ loopCount?: number }} [options]
 */
export function buildFixFollowupMessage(gateResult, options = {}) {
  const denied = gateResult.results.filter((r) => r.decision === 'deny');
  const summary = summarizeResults(denied.length > 0 ? denied : gateResult.results);
  const loopHint =
    typeof options.loopCount === 'number' && options.loopCount > 0
      ? `\n（第 ${options.loopCount + 1} 次自动重试）`
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

/** @param {{ checkId: string; decision: string; message: string }[]} results */
export function formatChecksForLog(results) {
  return results.map((r) => ({ id: r.checkId, decision: r.decision, message: r.message }));
}

/**
 * @param {string} stderr
 */
export function buildCommitFailureMessage(stderr) {
  return [
    '[auto-commit] git commit 执行失败，请修复后结束本轮重试：',
    '',
    stderr.trim().slice(0, 4000),
  ].join('\n');
}

/**
 * @param {string} cwd
 * @param {{ sessionId?: string }} [options]
 */
export async function runAutoCommit(cwd, options = {}) {
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

  const gateResult = await runQualityGate({ profile: 'commit', cwd, commitCmd });
  if (!gateResult.passed) {
    log(HOOK_NAME, {
      level: 'BLOCKED',
      branch,
      reason: gateResult.decision.reason?.slice(0, 500),
      checks: formatChecksForLog(gateResult.results),
      session_id: options.sessionId,
      cwd,
    });
    return {
      committed: false,
      reason: gateResult.decision.reason,
      gateFailed: true,
      gateResult,
    };
  }

  const commitResult = execCommand(commitCmd, { cwd, timeout: 30000 });
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
    return { committed: false, reason: errText, commitFailed: true };
  }

  const sha = execCommand('git rev-parse --short HEAD', { cwd }).stdout?.trim();
  log(HOOK_NAME, {
    level: 'COMMITTED',
    branch,
    message,
    sha,
    files: stagedFiles.length,
    checks: formatChecksForLog(gateResult.results),
    session_id: options.sessionId,
    cwd,
  });
  return { committed: true, message, sha };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = input.trim() ? JSON.parse(input) : {};
    const { cwd, sessionId, hookEvent, loopCount, status } = parseStopInput(data);
    const platform = getPlatform();

    if (platform === 'cursor' && status !== 'completed') {
      log(HOOK_NAME, { level: 'SKIP', reason: `status=${status}`, session_id: sessionId, cwd });
      console.log('{}');
      return;
    }

    const maxLoops = getMaxAutoCommitLoops();
    if (platform === 'cursor' && loopCount >= maxLoops) {
      log(HOOK_NAME, {
        level: 'SKIP',
        reason: `loop_limit ${maxLoops}`,
        loop_count: loopCount,
        session_id: sessionId,
        cwd,
      });
      console.error(`[auto-commit] 已达最大重试次数 (${maxLoops})，请手动修复后提交`);
      console.log('{}');
      return;
    }

    if (hookEvent === 'SubagentStop' && process.env.AUTO_COMMIT_SUBAGENT !== '1') {
      log(HOOK_NAME, { level: 'SKIP', reason: 'SubagentStop', session_id: sessionId, cwd });
      console.log('{}');
      return;
    }

    const result = await runAutoCommit(cwd, { sessionId });

    if (result.committed) {
      console.log(
        formatStopSuccessOutput(`[auto-commit] 已提交 ${result.sha}: ${result.message}`, hookEvent),
      );
      return;
    }

    if (result.gateFailed && result.gateResult) {
      const followup = buildFixFollowupMessage(result.gateResult, { loopCount });
      console.log(formatStopContinueOutput(followup, hookEvent));
      return;
    }

    if (result.commitFailed && result.reason) {
      console.log(formatStopContinueOutput(buildCommitFailureMessage(result.reason), hookEvent));
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

const isDirectRun = import.meta.main || (process.argv[1] && import.meta.url.endsWith(process.argv[1]));
if (isDirectRun) {
  main();
}

export { main };
