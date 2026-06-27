import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { isMergeConclude } from '../native/run-pre-commit.js';

describe('merge-conclude-gate', () => {
  let tempDir: string;
  let repoPath: string;

  beforeEach(() => {
    tempDir = join('/tmp', `merge-conclude-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    repoPath = join(tempDir, 'repo');
    mkdirSync(join(repoPath, '.git'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('无 MERGE_HEAD 时 isMergeConclude 为 false', () => {
    expect(isMergeConclude(repoPath)).toBe(false);
  });

  it('存在 MERGE_HEAD 时 isMergeConclude 为 true', () => {
    writeFileSync(join(repoPath, '.git', 'MERGE_HEAD'), 'abc123\n');
    expect(isMergeConclude(repoPath)).toBe(true);
  });
});
