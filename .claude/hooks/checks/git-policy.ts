import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';
import { readFileSync } from 'fs';
import type { CheckResult } from '../types.js';

const COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'docs',
  'test',
  'chore',
  'style',
  'perf',
  'build',
  'ci',
  'revert',
] as const;
const COMMIT_HEADER_PATTERN =
  /^(feat|fix|refactor|docs|test|chore|style|perf|build|ci|revert)(\([a-z0-9][a-z0-9._/-]*\))?(!)?: (.+)$/;
const COMMIT_SUBJECT_MAX = 72;
const PLACEHOLDER_SUBJECTS = /^(wip|tbd|todo|fixme|xxx|\.+)$/i;

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

type WorktreeAction = 'stop' | 'push' | 'merge';

const ACTION_STEPS: Record<WorktreeAction, string> = {
  stop: '4. 再结束本轮',
  push: '4. 再执行 git push',
  merge: '4. 再执行 git merge',
};

const ACTION_LABELS: Record<WorktreeAction, string> = {
  stop: '结束本轮',
  push: 'git push',
  merge: 'git merge',
};

export function extractCommitMessage(cmd: string): string | null {
  if (!cmd || typeof cmd !== 'string') return null;

  const normalized = cmd.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const commitMatch = /\bgit\s+commit\b/.exec(normalized);
  if (commitMatch?.index === undefined) return null;
  const rest = normalized.slice(commitMatch.index);

  const quotedDouble = /\s-m\s+"((?:[^"\\]|\\.)*)"/.exec(rest);
  if (quotedDouble?.[1]) {
    const inner = quotedDouble[1].replace(/\\"/g, '"').trim();
    const heredocInner = /(?:\$\(\s*)?cat\s+<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1(?:\s*\))?/.exec(inner);
    if (heredocInner?.[2]) return heredocInner[2].trim();
    return inner;
  }

  const quotedSingle = /\s-m\s+'([^']*)'/.exec(rest);
  if (quotedSingle?.[1]) return quotedSingle[1].trim();

  const heredoc = /\$\(\s*cat\s+<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*\)/.exec(rest);
  if (heredoc?.[2]) return heredoc[2].trim();

  const unquoted = /\s-m\s+(\S+)/.exec(rest);
  if (unquoted?.[1]) return unquoted[1].replace(/^["']|["']$/g, '').trim();

  return null;
}

export function getStagedFiles(cwd?: string): string[] {
  const result = execCommand('git diff --cached --name-only', { cwd });
  if (!result.success) return [];
  return result.stdout.trim().split('\n').filter(Boolean);
}

export function hasUncommittedChanges(cwd?: string): boolean {
  const result = execCommand('git status --porcelain', { cwd });
  if (!result.success) return false;
  return result.stdout.trim().length > 0;
}

export function countUncommittedFiles(cwd?: string): number {
  const result = execCommand('git status --porcelain', { cwd });
  if (!result.success) return 0;
  return result.stdout.trim().split('\n').filter(Boolean).length;
}

export function buildUncommittedWorktreeDenyReason(
  cwd: string,
  action: WorktreeAction,
  options: { prefix?: string } = {},
): string {
  const prefix = options.prefix ?? '';
  const branchResult = execCommand('git rev-parse --abbrev-ref HEAD', { cwd });
  const branch = branchResult.success ? branchResult.stdout.trim() : 'unknown';
  const fileCount = countUncommittedFiles(cwd);
  const actionStep = ACTION_STEPS[action];

  if (branch === 'main' || branch === 'master') {
    return [
      `${prefix}当前在 main/master 分支，请先切换到 feature 分支并 commit。`,
      '',
      `检测到 ${String(fileCount)} 个未提交变更。`,
      '',
      '步骤：',
      '1. git checkout -b feat/your-feature',
      '2. git add 相关文件（auto-stage 会自动暂存）',
      '3. git commit -m "类型: 描述"（需通过 pre-commit 质量门）',
      actionStep,
    ].join('\n');
  }

  const actionLabel = ACTION_LABELS[action];

  return [
    `${prefix}工作区有 ${String(fileCount)} 个未提交变更，请先 git commit 再${actionLabel}。`,
    '',
    `当前分支: ${branch}`,
    '',
    '步骤：',
    '1. git status 确认变更',
    '2. git add 相关文件（auto-stage 已暂存则跳过）',
    '3. git commit -m "类型: 描述"（feat/fix/docs/test/chore…，需通过 pre-commit 质量门）',
    actionStep,
  ].join('\n');
}

export function checkBranch(cwd?: string): CheckResult {
  const result = execCommand('git rev-parse --abbrev-ref HEAD', { cwd });
  const branch = result.success ? result.stdout.trim() : null;
  if (!branch) return formatResult('branch-check', DECISION.WARN, '无法获取当前分支名');
  if (branch === 'main' || branch === 'master') {
    return formatResult('branch-check', DECISION.DENY, `禁止在 ${branch} 分支上直接提交，请创建 feature 分支`);
  }
  return formatResult('branch-check', DECISION.ALLOW, `当前分支: ${branch}`);
}

export function checkCommitMessage(cmd: string): CheckResult {
  const message = extractCommitMessage(cmd);
  if (!message) {
    return formatResult('commit-msg', DECISION.DENY, '无法提取 commit message，请使用 -m "类型: 描述" 格式');
  }
  return validateCommitMessageText(message);
}

export function checkCommitMessageFromFile(msgFilePath: string): CheckResult {
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

export function validateCommitMessageText(message: string): CheckResult {
  const header = (message.split('\n')[0] ?? '').trim();
  if (header.length === 0) {
    return formatResult('commit-msg', DECISION.DENY, 'Commit message 为空');
  }
  const match = COMMIT_HEADER_PATTERN.exec(header);
  if (!match) {
    return formatResult(
      'commit-msg',
      DECISION.DENY,
      `Commit message 格式错误: "${header}" — 需为 "type(scope)!: 描述"，type ∈ {${COMMIT_TYPES.join(', ')}}`,
    );
  }
  if (header.length > COMMIT_SUBJECT_MAX) {
    return formatResult(
      'commit-msg',
      DECISION.DENY,
      `Commit 首行过长（${String(header.length)} > ${String(COMMIT_SUBJECT_MAX)}），请精简`,
    );
  }
  const subject = (match[4] ?? '').trim();
  if (PLACEHOLDER_SUBJECTS.test(subject)) {
    return formatResult('commit-msg', DECISION.DENY, `Commit 描述过于笼统: "${subject}"`);
  }
  return formatResult('commit-msg', DECISION.ALLOW, `Commit message 合规: "${header}"`);
}

export function checkSensitiveStagedFiles(cwd?: string): CheckResult {
  const stagedFiles = getStagedFiles(cwd);
  const matched = stagedFiles.filter((f) => SENSITIVE_PATTERNS.some((p) => p.test(f)));
  if (matched.length > 0) {
    return formatResult('sensitive-files', DECISION.DENY, `暂存区包含敏感文件: ${matched.join(', ')}`, {
      files: matched,
    });
  }
  return formatResult('sensitive-files', DECISION.ALLOW, '暂存区无敏感文件');
}

export function extractMergeTarget(cmd: string): string | null {
  const m = /\bgit\s+merge\b(?:\s+--[^\s]+)*\s+([^\s-][^\s]*)/.exec(cmd);
  return m?.[1] ?? null;
}

export function isGitPushCommand(cmd: string): boolean {
  return /\bgit\s+push\b/.test(cmd);
}

export function isGitCommitCommand(cmd: string): boolean {
  return /\bgit\s+commit\b/.test(cmd);
}

export function isGitMergeCommand(cmd: string): boolean {
  return /\bgit\s+merge\b/.test(cmd);
}
