import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { join, isAbsolute } from 'path';
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

export function filterExistingStagedFiles(files: string[], cwd?: string): string[] {
  const root = cwd ?? process.cwd();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- root 受信，f 为 git 暂存区文件路径
  return files.filter((f) => existsSync(join(root, f)));
}

export function hasUncommittedChanges(cwd?: string): boolean {
  const result = execCommand('git status --porcelain', { cwd });
  if (!result.success) return false;
  return result.stdout.trim().length > 0;
}

export const GENERIC_GITIGNORE_HINT =
  '若有无需纳入版本管理的本地文件，可将其路径加入 .gitignore，避免重复出现在未提交列表中。';

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
      '',
      GENERIC_GITIGNORE_HINT,
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
    '',
    GENERIC_GITIGNORE_HINT,
  ].join('\n');
}

export function checkBranch(cwd?: string): CheckResult {
  const result = execCommand('git rev-parse --abbrev-ref HEAD', { cwd });
  const branch = result.success ? result.stdout.trim() : null;
  if (!branch) return formatResult('branch-check', DECISION.DENY, '无法获取当前分支名');
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

export function resolveMergeHeadPath(cwd: string): string | null {
  const result = execCommand('git rev-parse --git-path MERGE_HEAD', { cwd });
  if (!result.success) return null;
  const mergeHeadPath = result.stdout.trim();
  if (mergeHeadPath.length === 0) return null;
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- mergeHeadPath 来自 git rev-parse --git-path，cwd 为受信仓库根
  return isAbsolute(mergeHeadPath) ? mergeHeadPath : join(cwd, mergeHeadPath);
}

export function isMergeConclude(cwd: string): boolean {
  const mergeHeadPath = resolveMergeHeadPath(cwd);
  return mergeHeadPath !== null && existsSync(mergeHeadPath);
}

const PROTECTED_BRANCHES = ['main', 'master'] as const;
const FEAT_TASK_BRANCH_PATTERN = /^feat\/.+-task-.+$/;

export function isProtectedBranch(branch: string): boolean {
  const name = normalizeBranchRef(branch);
  return PROTECTED_BRANCHES.includes(name as (typeof PROTECTED_BRANCHES)[number]);
}

export function isFeatTaskBranch(branch: string): boolean {
  return FEAT_TASK_BRANCH_PATTERN.test(normalizeBranchRef(branch));
}

export function resolveParentEpicBranch(taskBranch: string): string | null {
  const normalized = normalizeBranchRef(taskBranch);
  if (!isFeatTaskBranch(normalized)) return null;
  const taskIdx = normalized.indexOf('-task-');
  if (taskIdx <= 0) return null;
  return normalized.slice(0, taskIdx);
}

export function resolveMergeHeadBranch(cwd: string): string | null {
  if (!isMergeConclude(cwd)) return null;

  const decorated = execCommand('git log -1 --format=%D MERGE_HEAD', { cwd });
  if (decorated.success && decorated.stdout.trim()) {
    for (const part of decorated.stdout.split(',')) {
      const trimmed = part.trim().replace(/^HEAD\s*->\s*/, '');
      const branch = normalizeBranchRef(trimmed.replace(/^origin\//, ''));
      if (branch && branch !== 'HEAD') return branch;
    }
  }

  const nameRev = execCommand('git name-rev --name-only --exclude=tags/* MERGE_HEAD', { cwd });
  if (nameRev.success && nameRev.stdout.trim()) {
    const branch = normalizeBranchRef(nameRev.stdout.trim().replace(/[~^].*$/, ''));
    if (branch && branch !== 'undefined') return branch;
  }

  return null;
}

export function isIntegratorMerge(currentBranch: string, mergeSourceBranch: string | null): boolean {
  if (!mergeSourceBranch || !isFeatTaskBranch(mergeSourceBranch)) return false;
  const parent = resolveParentEpicBranch(mergeSourceBranch);
  return parent === normalizeBranchRef(currentBranch);
}

export function isTaskBranchMergedIntoEpicOrBase(branch: string, base: string, cwd?: string): boolean {
  if (isBranchMergedInto(branch, base, cwd)) return true;
  if (!isFeatTaskBranch(branch)) return false;
  const parent = resolveParentEpicBranch(branch);
  return Boolean(parent && isBranchMergedInto(branch, parent, cwd));
}

export function isGitBranchDeleteCommand(cmd: string): boolean {
  return /\bgit\s+branch\s+(-d|-D|--delete)\b/.test(cmd);
}

export function isGitRemoteBranchDeleteCommand(cmd: string): boolean {
  if (!/\bgit\s+push\b/.test(cmd)) return false;
  if (/--delete\b/.test(cmd)) return true;
  return /(?:^|\s):(?:refs\/heads\/)?[^\s:]+(?=\s|$)/.test(cmd);
}

export function isGitWorktreeRemoveCommand(cmd: string): boolean {
  return /\bgit\s+worktree\s+(remove|prune)\b/.test(cmd);
}

export function isGitWorktreePruneCommand(cmd: string): boolean {
  return /\bgit\s+worktree\s+prune\b/.test(cmd);
}

export function isGitRefDeleteBypass(cmd: string): boolean {
  return /\bgit\s+update-ref\s+-d\s+refs\/heads\//.test(cmd);
}

export function isGitBranchDeleteRelatedCommand(cmd: string): boolean {
  return (
    isGitBranchDeleteCommand(cmd) ||
    isGitRemoteBranchDeleteCommand(cmd) ||
    isGitWorktreeRemoveCommand(cmd) ||
    isGitRefDeleteBypass(cmd)
  );
}

function normalizeBranchRef(branch: string): string {
  return branch.replace(/^refs\/heads\//, '').replace(/^origin\//, '');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function extractBranchDeleteTargets(cmd: string): string[] {
  const match = /\bgit\s+branch\s+(?:-d|-D|--delete)\s+(.+)/i.exec(cmd);
  if (!match?.[1]) return [];
  return match[1]
    .trim()
    .split(/\s+/)
    .map(normalizeBranchRef)
    .filter((token) => token.length > 0 && !token.startsWith('-'));
}

export function extractRemoteBranchDeleteTargets(cmd: string): string[] {
  const targets: string[] = [];
  for (const match of cmd.matchAll(/--delete(?:\s+\S+)?\s+(\S+)/g)) {
    if (match[1]) targets.push(normalizeBranchRef(match[1]));
  }
  for (const match of cmd.matchAll(/(?:^|\s):(?:refs\/heads\/)?([^\s:]+)(?=\s|$)/g)) {
    if (match[1]) targets.push(normalizeBranchRef(match[1]));
  }
  return [...new Set(targets)];
}

export function extractUpdateRefDeleteTargets(cmd: string): string[] {
  const targets: string[] = [];
  for (const match of cmd.matchAll(/\bgit\s+update-ref\s+-d\s+refs\/heads\/(\S+)/g)) {
    if (match[1]) targets.push(normalizeBranchRef(match[1]));
  }
  return targets;
}

export function extractWorktreeRemovePaths(cmd: string): string[] {
  const match = /\bgit\s+worktree\s+remove(?:\s+(?:--force|-f))?\s+(\S+)/.exec(cmd);
  if (!match?.[1]) return [];
  return [match[1].replace(/^["']|["']$/g, '')];
}

export function resolveBaseBranch(cwd?: string): 'main' | 'master' | null {
  const main = execCommand('git rev-parse --verify main', { cwd });
  if (main.success) return 'main';
  const master = execCommand('git rev-parse --verify master', { cwd });
  if (master.success) return 'master';
  return null;
}

export function isBranchMergedInto(branch: string, base: string, cwd?: string): boolean {
  const normalized = normalizeBranchRef(branch);
  const candidates = [normalized, `origin/${normalized}`];
  for (const candidate of candidates) {
    const verify = execCommand(`git rev-parse --verify ${shellQuote(candidate)}`, { cwd });
    if (!verify.success) continue;
    const result = execCommand(`git merge-base --is-ancestor ${shellQuote(candidate)} ${shellQuote(base)}`, { cwd });
    if (result.success) return true;
  }
  return false;
}

function normalizeWorktreePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function worktreePathsEqual(a: string, b: string): boolean {
  return normalizeWorktreePath(a) === normalizeWorktreePath(b);
}

export function listWorktrees(repoCwd?: string): Map<string, string> {
  const result = execCommand('git worktree list --porcelain', { cwd: repoCwd });
  const map = new Map<string, string>();
  if (!result.success) return map;

  let currentPath: string | null = null;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim();
      continue;
    }
    if (line.startsWith('branch ') && currentPath) {
      const branch = normalizeBranchRef(line.slice('branch '.length).trim());
      map.set(currentPath, branch);
      currentPath = null;
    }
  }
  return map;
}

export function getWorktreeBranch(worktreePath: string, repoCwd?: string): string | null {
  for (const [path, branch] of listWorktrees(repoCwd)) {
    if (worktreePathsEqual(path, worktreePath)) return branch;
  }
  const head = execCommand('git rev-parse --abbrev-ref HEAD', { cwd: worktreePath });
  if (head.success) {
    const branch = head.stdout.trim();
    if (branch && branch !== 'HEAD') return branch;
  }
  return null;
}

export function buildProtectedBranchDeleteDenyReason(branch: string): string {
  return [
    `🔒 [branch-delete-gate] 禁止删除受保护分支 ${branch}（main/master）。`,
    '',
    '步骤：',
    '1. 切换到 feature 分支继续开发',
    '2. 禁止通过 AI 删除 main/master',
  ].join('\n');
}

export function buildUnmergedBranchDeleteDenyReason(branch: string, base: string): string {
  return [
    `🔒 [branch-delete-gate] 禁止删除未合并分支 ${branch}（尚未 merge 进 ${base}）。`,
    '',
    '步骤：',
    `1. git checkout ${base} && git merge ${branch}（或开 PR 合并）`,
    `2. 确认 git branch --merged ${base} 包含 ${branch}`,
    `3. 再执行 git branch -d ${branch}`,
  ].join('\n');
}

export function buildDirtyWorktreeDeleteDenyReason(worktreePath: string, branch: string): string {
  return [
    `🔒 [branch-delete-gate] 禁止删除含未提交变更的 worktree: ${worktreePath}`,
    '',
    `关联分支: ${branch}`,
    '',
    '步骤：',
    '1. 进入 worktree 目录执行 git status 确认变更',
    '2. git add / git commit（需通过 pre-commit 质量门）',
    '3. merge 进 main/master 后再 git worktree remove',
  ].join('\n');
}

export function buildWorktreePruneDenyReason(): string {
  return [
    '🔒 [branch-delete-gate] 禁止 AI 执行 git worktree prune。',
    '',
    '步骤：',
    '1. 使用 git worktree list 确认目标路径',
    '2. merge 并 commit 后执行 git worktree remove <path>',
  ].join('\n');
}

export function evaluateBranchDeleteCommand(cmd: string, cwd: string): CheckResult | null {
  if (!isGitBranchDeleteRelatedCommand(cmd)) return null;

  const insideGit = execCommand('git rev-parse --is-inside-work-tree', { cwd });
  if (!insideGit.success) {
    return formatResult(
      'branch-delete-gate',
      DECISION.DENY,
      '🔒 [branch-delete-gate] 非 Git 仓库，禁止执行分支/worktree 删除命令',
    );
  }

  if (isGitWorktreePruneCommand(cmd)) {
    return formatResult('branch-delete-gate', DECISION.DENY, buildWorktreePruneDenyReason());
  }

  const base = resolveBaseBranch(cwd);
  if (!base) {
    return formatResult(
      'branch-delete-gate',
      DECISION.DENY,
      '🔒 [branch-delete-gate] 无法确定 main/master 基准分支，禁止删除操作',
    );
  }

  execCommand('git fetch --quiet', { cwd, timeout: 60000 });

  const branchTargets = [
    ...extractBranchDeleteTargets(cmd),
    ...extractRemoteBranchDeleteTargets(cmd),
    ...extractUpdateRefDeleteTargets(cmd),
  ];

  for (const branch of branchTargets) {
    if (isProtectedBranch(branch)) {
      return formatResult('branch-delete-gate', DECISION.DENY, buildProtectedBranchDeleteDenyReason(branch));
    }
    if (!isTaskBranchMergedIntoEpicOrBase(branch, base, cwd)) {
      return formatResult('branch-delete-gate', DECISION.DENY, buildUnmergedBranchDeleteDenyReason(branch, base));
    }
  }

  for (const worktreePath of extractWorktreeRemovePaths(cmd)) {
    const branch = getWorktreeBranch(worktreePath, cwd);
    if (!branch) {
      return formatResult(
        'branch-delete-gate',
        DECISION.DENY,
        `🔒 [branch-delete-gate] 无法解析 worktree 关联分支: ${worktreePath}`,
      );
    }
    if (isProtectedBranch(branch)) {
      return formatResult('branch-delete-gate', DECISION.DENY, buildProtectedBranchDeleteDenyReason(branch));
    }
    if (hasUncommittedChanges(worktreePath)) {
      return formatResult(
        'branch-delete-gate',
        DECISION.DENY,
        buildDirtyWorktreeDeleteDenyReason(worktreePath, branch),
      );
    }
    if (!isTaskBranchMergedIntoEpicOrBase(branch, base, cwd)) {
      return formatResult('branch-delete-gate', DECISION.DENY, buildUnmergedBranchDeleteDenyReason(branch, base));
    }
  }

  const isDeleteWithoutTargets =
    (isGitBranchDeleteCommand(cmd) ||
      isGitRemoteBranchDeleteCommand(cmd) ||
      isGitRefDeleteBypass(cmd) ||
      /\bgit\s+worktree\s+remove\b/.test(cmd)) &&
    branchTargets.length === 0 &&
    extractWorktreeRemovePaths(cmd).length === 0;

  if (isDeleteWithoutTargets) {
    return formatResult('branch-delete-gate', DECISION.DENY, '🔒 [branch-delete-gate] 无法解析删除目标，禁止执行');
  }

  return null;
}
