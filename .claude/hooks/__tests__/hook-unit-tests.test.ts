import { describe, it, expect } from 'bun:test';
import { isHooksProject } from '../checks/hooks-project.js';
import { runHookUnitTests } from '../checks/tests.js';
import { evaluateCoverageAgainstThresholds, parseCoverageMetrics } from '../checks/coverage.js';
import { DECISION } from '../security-orchestrator.js';
import { PROJECT_ROOT } from './helpers.js';

describe('runHookUnitTests', () => {
  it('非 hooks 项目 SKIP', async () => {
    const r = await runHookUnitTests('/tmp');
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('isHooksProject PROJECT_ROOT 为 true', () => {
    expect(isHooksProject(PROJECT_ROOT)).toBe(true);
  });

  it('双阈值 DENY 消息格式', () => {
    const sample = 'All files | 70.00 | 75.00 |';
    const metrics = parseCoverageMetrics(sample);
    const eval_ = evaluateCoverageAgainstThresholds(metrics, { lines: 80, functions: 80 });
    expect(eval_.pass).toBe(false);
    expect(eval_.message).toContain('Hook 单测通过但覆盖率未达标');
  });
});
