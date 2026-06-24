import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  getHeadTreeSha,
  getIndexTreeSha,
  hasFreshFullPass,
  recordFullPass,
  clearFullPass,
  makeFullPassCacheKey,
} from '../gate-cache.js';
import { LOG_DIR } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo, writeFile } from './helpers.js';

const CACHE_FILE = join(LOG_DIR, 'gate-full-pass-cache.json');

describe('gate-cache', () => {
  let repoDir: string;

  beforeEach(() => {
    if (existsSync(CACHE_FILE)) rmSync(CACHE_FILE);
    repoDir = createTempGitRepo('feature');
    writeFile(repoDir, 'sample.txt', 'hello');
  });

  afterEach(() => {
    clearFullPass(repoDir);
    cleanupTempGitRepo(repoDir);
    if (existsSync(CACHE_FILE)) rmSync(CACHE_FILE);
  });

  it('recordFullPass + hasFreshFullPass 命中相同树', () => {
    const tree = getHeadTreeSha(repoDir);
    expect(tree).toBeTruthy();
    if (!tree) return;

    recordFullPass(repoDir, tree);
    expect(hasFreshFullPass(repoDir, tree)).toBe(true);
  });

  it('树变化后不命中', () => {
    const tree = getHeadTreeSha(repoDir);
    expect(tree).toBeTruthy();
    if (!tree) return;

    recordFullPass(repoDir, tree);
    expect(hasFreshFullPass(repoDir, 'different-tree-sha')).toBe(false);
  });

  it('clearFullPass 清除缓存', () => {
    const tree = getHeadTreeSha(repoDir);
    expect(tree).toBeTruthy();
    if (!tree) return;

    recordFullPass(repoDir, tree);
    clearFullPass(repoDir);
    expect(hasFreshFullPass(repoDir, tree)).toBe(false);
  });

  it('makeFullPassCacheKey 对同 cwd 稳定', () => {
    const a = makeFullPassCacheKey(repoDir);
    const b = makeFullPassCacheKey(repoDir);
    expect(a).toBe(b);
  });

  it('getIndexTreeSha 返回非空', () => {
    const indexTree = getIndexTreeSha(repoDir);
    expect(indexTree).toBeTruthy();
  });
});
