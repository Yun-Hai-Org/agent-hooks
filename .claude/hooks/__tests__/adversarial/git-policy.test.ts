import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { disableGlobalGitHooks } from '../helpers.js';
import {
  isGitPushCommand,
  isGitCommitCommand,
  isGitMergeCommand,
  isGitBranchDeleteCommand,
  isGitRemoteBranchDeleteCommand,
  isGitWorktreeRemoveCommand,
  isGitRefDeleteBypass,
  extractBranchDeleteTargets,
  extractRemoteBranchDeleteTargets,
  extractWorktreeRemovePaths,
  hasUncommittedChanges,
  buildUncommittedWorktreeDenyReason,
} from '../../checks/git-policy.js';

describe('adversarial: git-policy command detection', () => {
  it('应识别变体 git commit', () => {
    expect(isGitCommitCommand('git commit -m "feat: x"')).toBe(true);
    expect(isGitCommitCommand('git  commit -m "feat: x"')).toBe(true);
    expect(isGitCommitCommand('git status')).toBe(false);
  });

  it('应识别变体 git push', () => {
    expect(isGitPushCommand('git push origin feat/x')).toBe(true);
    expect(isGitPushCommand('git push')).toBe(true);
    expect(isGitPushCommand('git pull')).toBe(false);
  });

  it('应识别变体 git merge', () => {
    expect(isGitMergeCommand('git merge --no-ff feat/x')).toBe(true);
    expect(isGitMergeCommand('git merge feat/x')).toBe(true);
    expect(isGitMergeCommand('git checkout feat/x')).toBe(false);
  });

  it('应识别分支/worktree 删除命令', () => {
    expect(isGitBranchDeleteCommand('git branch -D feat/x')).toBe(true);
    expect(isGitBranchDeleteCommand('git  branch  --delete feat/x')).toBe(true);
    expect(isGitRemoteBranchDeleteCommand('git push origin --delete feat/x')).toBe(true);
    expect(isGitRemoteBranchDeleteCommand('git push origin :feat/x')).toBe(true);
    expect(isGitWorktreeRemoveCommand('git worktree remove /tmp/wt')).toBe(true);
    expect(isGitWorktreeRemoveCommand('git worktree prune')).toBe(true);
    expect(isGitRefDeleteBypass('git update-ref -d refs/heads/feat/x')).toBe(true);
    expect(isGitBranchDeleteCommand('git branch')).toBe(false);
  });

  it('应解析删除目标', () => {
    expect(extractBranchDeleteTargets('git branch -D feat/a feat/b')).toEqual(['feat/a', 'feat/b']);
    expect(extractRemoteBranchDeleteTargets('git push origin --delete feat/x')).toEqual(['feat/x']);
    expect(extractRemoteBranchDeleteTargets('git push origin :refs/heads/feat/x')).toEqual(['feat/x']);
    expect(extractWorktreeRemovePaths('git worktree remove --force /tmp/wt')).toEqual(['/tmp/wt']);
  });
});

describe('adversarial: git-policy uncommitted worktree', () => {
  let tempDir;
  let repoPath;

  beforeEach(() => {
    tempDir = join('/tmp', `git-policy-test-${Date.now()}`);
    repoPath = join(tempDir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    execSync('git init -b feat/test', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
    disableGlobalGitHooks(repoPath);
    writeFileSync(join(repoPath, 'README.md'), '# test\n');
    execSync('git add README.md', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "chore: init"', { cwd: repoPath, stdio: 'pipe' });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('hasUncommittedChanges 干净时为 false', () => {
    expect(hasUncommittedChanges(repoPath)).toBe(false);
  });

  it('buildUncommittedWorktreeDenyReason push 应要求先 commit', () => {
    writeFileSync(join(repoPath, 'dirty.js'), 'x');
    const msg = buildUncommittedWorktreeDenyReason(repoPath, 'push');
    expect(msg).toContain('git commit');
    expect(msg).toContain('git push');
  });

  it('buildUncommittedWorktreeDenyReason merge 应要求先 commit', () => {
    writeFileSync(join(repoPath, 'dirty.js'), 'x');
    const msg = buildUncommittedWorktreeDenyReason(repoPath, 'merge');
    expect(msg).toContain('git commit');
    expect(msg).toContain('git merge');
  });
});
