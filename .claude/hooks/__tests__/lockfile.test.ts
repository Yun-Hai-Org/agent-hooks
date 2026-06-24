import { describe, it, expect, afterEach } from 'bun:test';
import { runLockfileFreshness } from '../checks/lockfile.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('runLockfileFreshness', () => {
  let repoDir: string | undefined;

  afterEach(() => {
    if (repoDir) {
      cleanupTempGitRepo(repoDir);
      repoDir = undefined;
    }
  });

  it('暂存区无依赖清单变更时 SKIP', () => {
    repoDir = createTempGitRepo('feature');
    const result = runLockfileFreshness(repoDir, { staged: true });
    expect(result.checkId).toBe('lockfile-freshness');
    expect(result.decision).toBe(DECISION.SKIP);
  });

  it('目录无 package.json/pyproject.toml 时（full）SKIP', () => {
    const result = runLockfileFreshness('/tmp/nonexistent-lockfile-dir-xyz');
    expect(result.decision).toBe(DECISION.SKIP);
  });
});
