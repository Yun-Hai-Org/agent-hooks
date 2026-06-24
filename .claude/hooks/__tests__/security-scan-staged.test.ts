import { describe, it, expect, afterEach } from 'bun:test';
import { runSemgrepStaged } from '../checks/security-scan.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('runSemgrepStaged', () => {
  let repoDir: string | undefined;

  afterEach(() => {
    if (repoDir) {
      cleanupTempGitRepo(repoDir);
      repoDir = undefined;
    }
  });

  it('无暂存文件时 SKIP', async () => {
    repoDir = createTempGitRepo('feature');
    const result = await runSemgrepStaged(repoDir);
    expect(result.checkId).toBe('semgrep-staged');
    expect(result.decision).toBe(DECISION.SKIP);
  });
});
