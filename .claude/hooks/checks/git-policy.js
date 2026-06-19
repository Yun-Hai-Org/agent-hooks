import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';

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
  const mMatch = cmd.match(/\bgit\s+commit\b[^"]*?-m\s+["']([^"']+)["']/);
  if (mMatch) return mMatch[1];
  const mMatch2 = cmd.match(/\bgit\s+commit\b.*?\s-m\s+([^\s-][^\s]*)/);
  if (mMatch2) return mMatch2[1];
  return null;
}

/** @param {string} [cwd] */
export function getStagedFiles(cwd) {
  const result = execCommand('git diff --cached --name-only', { cwd });
  if (!result.success) return [];
  return result.stdout.trim().split('\n').filter(Boolean);
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
