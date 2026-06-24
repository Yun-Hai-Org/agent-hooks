import { describe, it, expect, afterEach } from 'bun:test';
import { runSemgrepStaged, evaluateSemgrepOutput } from '../checks/security-scan.js';
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

describe('evaluateSemgrepOutput', () => {
  it('发现 ERROR/WARNING 即使退出码为 0 也应 DENY', () => {
    const stdout = JSON.stringify({
      results: [{ extra: { severity: 'ERROR' } }, { extra: { severity: 'WARNING' } }],
    });
    const r = evaluateSemgrepOutput(stdout, 'semgrep');
    expect(r?.decision).toBe(DECISION.DENY);
  });

  it('无 ERROR/WARNING（仅 INFO）应返回 null', () => {
    const stdout = JSON.stringify({ results: [{ extra: { severity: 'INFO' } }] });
    expect(evaluateSemgrepOutput(stdout, 'semgrep')).toBeNull();
  });

  it('输出无法解析应 fail-closed DENY', () => {
    const r = evaluateSemgrepOutput('not-json <<<', 'semgrep');
    expect(r?.decision).toBe(DECISION.DENY);
    expect(r?.message).toContain('无法解析');
  });
});
