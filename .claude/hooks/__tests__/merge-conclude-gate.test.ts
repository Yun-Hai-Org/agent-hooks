import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { isMergeConclude, resolveMergeHeadPath } from '../checks/git-policy.js';

describe('merge-conclude-gate', () => {
  let tempDir: string;
  let repoPath: string;

  beforeEach(() => {
    tempDir = join('/tmp', `merge-conclude-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    repoPath = join(tempDir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('无 MERGE_HEAD 时 isMergeConclude 为 false', () => {
    expect(isMergeConclude(repoPath)).toBe(false);
  });

  it('存在 MERGE_HEAD 时 isMergeConclude 为 true', () => {
    const mergeHeadPath = resolveMergeHeadPath(repoPath);
    expect(mergeHeadPath).not.toBeNull();
    writeFileSync(mergeHeadPath!, 'abc123\n');
    expect(isMergeConclude(repoPath)).toBe(true);
  });
});
