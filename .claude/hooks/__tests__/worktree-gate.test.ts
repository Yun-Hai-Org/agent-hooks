import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { isFeatBranch, isWorktreeBootstrapCommand } from '../worktree-gate.js';
import { isInsideWorktree } from '../branch-gate.js';

describe('worktree-gate helpers', () => {
  it('isFeatBranch accepts feat/* and task branches', () => {
    expect(isFeatBranch('feat/foo')).toBe(true);
    expect(isFeatBranch('feat/hooks-restore-workflow-p2-json')).toBe(true);
    expect(isFeatBranch('master')).toBe(false);
  });

  it('isWorktreeBootstrapCommand allows git worktree add', () => {
    expect(isWorktreeBootstrapCommand('git worktree add .worktrees/x -b feat/x')).toBe(true);
    expect(isWorktreeBootstrapCommand('git status')).toBe(false);
  });
});

describe('isInsideWorktree', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join('/tmp', `wt-gate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true when .git is a file (worktree)', () => {
    writeFileSync(join(tempDir, '.git'), 'gitdir: /path/to/main/.git/worktrees/foo\n', 'utf8');
    expect(isInsideWorktree(tempDir)).toBe(true);
  });

  it('returns false when .git is a directory (main checkout)', () => {
    mkdirSync(join(tempDir, '.git'));
    expect(isInsideWorktree(tempDir)).toBe(false);
  });
});
