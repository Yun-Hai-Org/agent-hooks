import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';
import { readFileSync } from 'fs';

const COMMIT_MSG_PATTERN = /^(feat|fix|refactor|docs|test|chore|style|perf):\s+\S/;

const SENSITIVE_PATTERNS = [
  /\.env$/,
  /\.env\.local$/,
  /\.env\.production$/,
  /\.ssh\/id_/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /credentials\.json$/,
];

/** @param {string} cmd */
export function extractCommitMessage(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;

  const normalized = cmd.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const commitMatch = normalized.match(/\bgit\s+commit\b/);
  if (!commitMatch || commitMatch.index === undefined) return null;
  const rest = normalized.slice(commitMatch.index);

  const quotedDouble = rest.match(/\s-m\s+"((?:[^"\\]|\\.)*)"/);
  if (quotedDouble) {
    const inner = quotedDouble[1].replace(/\\"/g, '"').trim();
    const heredocInner = inner.match(/(?:\$\(\s*)?cat\s+<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1(?:\s*\))?/);
    if (heredocInner) return heredocInner[2].trim();
    return inner;
  }

  const quotedSingle = rest.match(/\s-m\s+'([^']*)'/);
  if (quotedSingle) return quotedSingle[1].trim();

  const heredoc = rest.match(/\$\(\s*cat\s+<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*\)/);
  if (heredoc) return heredoc[2].trim();

  const unquoted = rest.match(/\s-m\s+(\S+)/);
  if (unquoted) return unquoted[1].replace(/^["']|["']$/g, '').trim();

  return null;
}

/** @param {string} [cwd] @returns {string[]} */
export function getStagedFiles(cwd) {
  const result = execCommand('git diff --cached --name-only', { cwd });
  if (!result.success) return [];
  return result.stdout.trim().split('\n').filter(Boolean);
}

/** @param {string} [cwd] */
export function hasUncommittedChanges(cwd) {
  const result = execCommand('git status --porcelain', { cwd });
  if (!result.success) return false;
  return result.stdout.trim().length > 0;
}

/** @param {string} [cwd] */
export function countUncommittedFiles(cwd) {
  const result = execCommand('git status --porcelain', { cwd });
  if (!result.success) return 0;
  return result.stdout.trim().split('\n').filter(Boolean).length;
}

/**
 * @param {string} cwd
 * @param {'stop' | 'push' | 'merge'} action
 * @param {{ prefix?: string }} [options]
 */
export function buildUncommittedWorktreeDenyReason(cwd, action, options = {}) {
  const prefix = options.prefix ?? '';
  const branchResult = execCommand('git rev-parse --abbrev-ref HEAD', { cwd });
  const branch = branchResult.success ? branchResult.stdout.trim() : 'unknown';
  const fileCount = countUncommittedFiles(cwd);
  const actionSteps = {
    stop: '4. 再结束本轮',
    push: '4. 再执行 git push',
    merge: '4. 再执行 git merge',
  };

  if (branch === 'main' || branch === 'master') {
    return [
      `${prefix}当前在 main/master 分支，请先切换到 feature 分支并 commit。`,
      '',
      `检测到 ${fileCount} 个未提交变更。`,
      '',
      '步骤：',
      '1. git checkout -b feat/your-feature',
      '2. git add 相关文件（auto-stage 会自动暂存）',
      '3. git commit -m "类型: 描述"（需通过 pre-commit 质量门）',
      actionSteps[action],
    ].join('\n');
  }

  const actionLabel = { stop: '结束本轮', push: 'git push', merge: 'git merge' }[action];

  return [
    `${prefix}工作区有 ${fileCount} 个未提交变更，请先 git commit 再${actionLabel}。`,
    '',
    `当前分支: ${branch}`,
    '',
    '步骤：',
    '1. git status 确认变更',
    '2. git add 相关文件（auto-stage 已暂存则跳过）',
    '3. git commit -m "类型: 描述"（feat/fix/docs/test/chore…，需通过 pre-commit 质量门）',
    actionSteps[action],
  ].join('\n');
}

/** @param {string} [cwd] */
export function checkBranch(cwd) {
  const result = execCommand('git rev-parse --abbrev-ref HEAD', { cwd });
  const branch = result.success ? result.stdout.trim() : null;
  if (!branch) return formatResult('branch-check', DECISION.WARN, '无法获取当前分支名');
  if (branch === 'main' || branch === 'master') {
    return formatResult('branch-check', DECISION.DENY, `禁止在 ${branch} 分支上直接提交，请创建 feature 分支`);
  }
  return formatResult('branch-check', DECISION.ALLOW, `当前分支: ${branch}`);
}

/** @param {string} cmd */
export function checkCommitMessage(cmd) {
  const message = extractCommitMessage(cmd);
  if (!message) {
    return formatResult('commit-msg', DECISION.DENY, '无法提取 commit message，请使用 -m "类型: 描述" 格式');
  }
  return validateCommitMessageText(message);
}

/**
 * @param {string} msgFilePath
 */
export function checkCommitMessageFromFile(msgFilePath) {
  try {
    const raw = readFileSync(msgFilePath, 'utf8');
    const message = raw
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
      .trim();
    if (!message) {
      return formatResult('commit-msg', DECISION.DENY, 'Commit message 为空');
    }
    return validateCommitMessageText(message);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return formatResult('commit-msg', DECISION.DENY, `无法读取 commit message 文件: ${err}`);
  }
}

/** @param {string} message */
function validateCommitMessageText(message) {
  if (!COMMIT_MSG_PATTERN.test(message)) {
    return formatResult('commit-msg', DECISION.DENY, `Commit message 格式错误: "${message}" — 必须匹配 "类型: 描述"`);
  }
  return formatResult('commit-msg', DECISION.ALLOW, `Commit message 格式正确: "${message}"`);
}

/** @param {string} [cwd] */
export function checkSensitiveStagedFiles(cwd) {
  const stagedFiles = getStagedFiles(cwd);
  const matched = stagedFiles.filter((f) => SENSITIVE_PATTERNS.some((p) => p.test(f)));
  if (matched.length > 0) {
    return formatResult('sensitive-files', DECISION.DENY, `暂存区包含敏感文件: ${matched.join(', ')}`, {
      files: matched,
    });
  }
  return formatResult('sensitive-files', DECISION.ALLOW, '暂存区无敏感文件');
}

/** @param {string} cmd */
export function extractMergeTarget(cmd) {
  const m = cmd.match(/\bgit\s+merge\b(?:\s+--[^\s]+)*\s+([^\s-][^\s]*)/);
  return m ? m[1] : null;
}

/** @param {string} cmd */
export function isGitPushCommand(cmd) {
  return /\bgit\s+push\b/.test(cmd);
}

/** @param {string} cmd */
export function isGitCommitCommand(cmd) {
  return /\bgit\s+commit\b/.test(cmd);
}

/** @param {string} cmd */
export function isGitMergeCommand(cmd) {
  return /\bgit\s+merge\b/.test(cmd);
}
