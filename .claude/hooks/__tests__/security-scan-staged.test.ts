import { describe, it, expect } from 'bun:test';
import { runSemgrepStaged } from '../checks/security-scan.js';
import { DECISION } from '../security-orchestrator.js';

describe('runSemgrepStaged', () => {
  it('无暂存文件时 SKIP', async () => {
    const result = await runSemgrepStaged(process.cwd());
    expect(result.checkId).toBe('semgrep-staged');
    expect(result.decision).toBe(DECISION.SKIP);
  });
});
