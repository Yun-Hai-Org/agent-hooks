import { describe, it, expect } from 'bun:test';
import { isHooksProject } from '../checks/hooks-project.js';
import { parseBunTestRunSummary, runHookUnitTests } from '../checks/tests.js';
import { evaluateCoverageAgainstThresholds, parseCoverageMetrics } from '../checks/coverage.js';
import { DECISION } from '../security-orchestrator.js';
import { PROJECT_ROOT } from './helpers.js';

describe('parseBunTestRunSummary', () => {
  it('应取末行 fail 计数而非 coverage 行', () => {
    const output = ['All files | 70.00 | 1 fail |', '', ' 52 pass', ' 0 fail', 'Ran 52 tests across 2 files.'].join(
      '\n',
    );
    expect(parseBunTestRunSummary(output).failCount).toBe(0);
  });

  it('应解析 (pass)/(fail) 摘要行', () => {
    const output = ' 10 pass\n 2 fail\nRan 12 tests across 1 files.';
    const summary = parseBunTestRunSummary(output);
    expect(summary.failCount).toBe(2);
    expect(summary.passCount).toBe(10);
  });

  it('应忽略测试标题中的 (pass)/(fail) 字样', () => {
    const output = [
      '(pass) parseBunTestRunSummary > 应解析 (pass)/(fail) 摘要行',
      ' 1146 pass',
      ' 0 fail',
      'Ran 1146 tests across 71 files.',
    ].join('\n');
    const summary = parseBunTestRunSummary(output);
    expect(summary.failCount).toBe(0);
    expect(summary.passCount).toBe(1146);
  });

  it('无摘要时 failCount 为 0 且 parsed false', () => {
    expect(parseBunTestRunSummary('random output')).toEqual({ failCount: 0, parsed: false });
  });
});

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
