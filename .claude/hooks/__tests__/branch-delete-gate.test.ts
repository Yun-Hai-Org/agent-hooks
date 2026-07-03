import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { DECISION } from '../security-orchestrator.js';
import { evaluateBranchDeleteCommand } from '../checks/git-policy.js';

import { disableGlobalGitHooks } from './helpers.js';

describe('branch-delete-gate', () => {
  let tempDir: string;
  let repoPath: string;

  beforeEach(() => {
    tempDir = join('/tmp', `branch-delete-gate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    repoPath = join(tempDir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    execSync('git init -b main', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
    disableGlobalGitHooks(repoPath);
    writeFileSync(join(repoPath, 'README.md'), '# main\n');
    execSync('git add README.md', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "chore: init main"', { cwd: repoPath, stdio: 'pipe' });
  });

  afterEach(() => {
    try {
      execSync('git worktree prune', { cwd: repoPath, stdio: 'pipe' });
    } catch {}
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  function createUnmergedFeatureBranch(name = 'feat/unmerged') {
    execSync(`git checkout -b ${name}`, { cwd: repoPath, stdio: 'pipe' });
    writeFileSync(join(repoPath, 'feature.txt'), 'feature\n');
    execSync('git add feature.txt', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "feat: add feature"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git checkout main', { cwd: repoPath, stdio: 'pipe' });
    return name;
  }

  it('非 delete 命令应放行', () => {
    expect(evaluateBranchDeleteCommand('git status', repoPath)).toBeNull();
    expect(evaluateBranchDeleteCommand('git branch', repoPath)).toBeNull();
  });

  it('未合并分支 git branch -D 应 deny', () => {
    const branch = createUnmergedFeatureBranch();
    const result = evaluateBranchDeleteCommand(`git branch -D ${branch}`, repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
    expect(result?.message).toContain('未合并');
    expect(result?.message).toContain(branch);
  });

  it('git  branch  -D 变体应 deny', () => {
    const branch = createUnmergedFeatureBranch();
    const result = evaluateBranchDeleteCommand(`git  branch  -D ${branch}`, repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
  });

  it('已合并分支 git branch -d 应放行', () => {
    const branch = createUnmergedFeatureBranch();
    execSync(`git merge ${branch} --no-edit`, { cwd: repoPath, stdio: 'pipe' });
    expect(evaluateBranchDeleteCommand(`git branch -d ${branch}`, repoPath)).toBeNull();
  });

  it('删除 main 应 deny', () => {
    const result = evaluateBranchDeleteCommand('git branch -D main', repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
    expect(result?.message).toContain('受保护');
  });

  it('git push origin --delete 未合并分支应 deny', () => {
    const branch = createUnmergedFeatureBranch('feat/remote-delete');
    const result = evaluateBranchDeleteCommand(`git push origin --delete ${branch}`, repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
  });

  it('git push origin :branch 未合并应 deny', () => {
    const branch = createUnmergedFeatureBranch('feat/colon-delete');
    const result = evaluateBranchDeleteCommand(`git push origin :${branch}`, repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
  });

  it('git worktree remove 未合并分支 worktree 应 deny', () => {
    const branch = createUnmergedFeatureBranch('feat/wt-unmerged');
    const wtPath = join(tempDir, 'wt-unmerged');
    execSync(`git worktree add "${wtPath}" "${branch}"`, { cwd: repoPath, stdio: 'pipe' });
    const result = evaluateBranchDeleteCommand(`git worktree remove "${wtPath}"`, repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
    expect(result?.message).toContain('未合并');
  });

  it('已合并但脏 worktree remove 应 deny', () => {
    const branch = createUnmergedFeatureBranch('feat/wt-dirty');
    const wtPath = join(tempDir, 'wt-dirty');
    execSync(`git merge ${branch} --no-edit`, { cwd: repoPath, stdio: 'pipe' });
    execSync(`git worktree add "${wtPath}" "${branch}"`, { cwd: repoPath, stdio: 'pipe' });
    writeFileSync(join(wtPath, 'dirty.txt'), 'dirty\n');
    const result = evaluateBranchDeleteCommand(`git worktree remove "${wtPath}"`, repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
    expect(result?.message).toContain('未提交');
  });

  it('git worktree prune 应 deny', () => {
    const result = evaluateBranchDeleteCommand('git worktree prune', repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
    expect(result?.message).toContain('worktree prune');
  });

  it('git update-ref -d 未合并分支应 deny', () => {
    const branch = createUnmergedFeatureBranch('feat/update-ref');
    const result = evaluateBranchDeleteCommand(`git update-ref -d refs/heads/${branch}`, repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
  });

  it('feat/*-task-* 已 merge 进父 epic 时 worktree remove 应放行', () => {
    const epic = 'feat/hooks-restore-workflow';
    const taskBranch = 'feat/hooks-restore-workflow-task-p2-json';
    execSync(`git checkout -b ${epic}`, { cwd: repoPath, stdio: 'pipe' });
    execSync(`git checkout -b ${taskBranch}`, { cwd: repoPath, stdio: 'pipe' });
    writeFileSync(join(repoPath, 'task.txt'), 'task\n');
    execSync('git add task.txt', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "feat: task work"', { cwd: repoPath, stdio: 'pipe' });
    execSync(`git checkout ${epic}`, { cwd: repoPath, stdio: 'pipe' });
    execSync(`git merge ${taskBranch} --no-edit`, { cwd: repoPath, stdio: 'pipe' });
    const wtPath = join(tempDir, 'wt-task-merged');
    execSync(`git worktree add "${wtPath}" "${taskBranch}"`, { cwd: repoPath, stdio: 'pipe' });
    expect(evaluateBranchDeleteCommand(`git worktree remove "${wtPath}"`, repoPath)).toBeNull();
  });

  it('feat/*-task-* 未 merge 进父 epic 时 worktree remove 应 deny', () => {
    const epic = 'feat/hooks-restore-workflow';
    const taskBranch = 'feat/hooks-restore-workflow-task-unmerged';
    execSync(`git checkout -b ${epic}`, { cwd: repoPath, stdio: 'pipe' });
    execSync(`git checkout -b ${taskBranch}`, { cwd: repoPath, stdio: 'pipe' });
    writeFileSync(join(repoPath, 'unmerged.txt'), 'unmerged\n');
    execSync('git add unmerged.txt', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "feat: unmerged task"', { cwd: repoPath, stdio: 'pipe' });
    execSync(`git checkout ${epic}`, { cwd: repoPath, stdio: 'pipe' });
    const wtPath = join(tempDir, 'wt-task-unmerged');
    execSync(`git worktree add "${wtPath}" "${taskBranch}"`, { cwd: repoPath, stdio: 'pipe' });
    const result = evaluateBranchDeleteCommand(`git worktree remove "${wtPath}"`, repoPath);
    expect(result?.decision).toBe(DECISION.DENY);
    expect(result?.message).toContain('未合并');
  });
});
