import { describe, it, expect } from 'bun:test';
import { runPyDepAudit } from '../checks/py-dep-audit.js';
import { DECISION } from '../security-orchestrator.js';

describe('py-dep-audit', () => {
  it('无 pyproject.toml 时 SKIP', async () => {
    const result = await runPyDepAudit('/tmp/nonexistent-pyproject-dir');
    expect(result.decision).toBe(DECISION.SKIP);
  });

  it('本项目无 Python 运行时依赖时 SKIP', async () => {
    const result = await runPyDepAudit(process.cwd());
    expect(result.checkId).toBe('py-dep-audit');
    expect(result.decision).toBe(DECISION.SKIP);
    expect(result.message).toContain('无 Python 运行时依赖');
  });
});
