import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  parseCoverageMetrics,
  parseCoveragePercent,
  evaluateCoverageAgainstThresholds,
  DEFAULT_COVERAGE_THRESHOLDS,
  runCoverage,
} from '../checks/coverage.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('parseCoverageMetrics', () => {
  it('应从 All files 行解析 Funcs 与 Lines', () => {
    const output = `
-----------------------------------------------|---------|---------|-------------------
All files                                      |   61.77 |   52.79 |
 .claude/hooks/foo.ts                          |  100.00 |  100.00 |
`;
    const m = parseCoverageMetrics(output);
    expect(m.functions).toBe(61.77);
    expect(m.lines).toBe(52.79);
  });

  it('无 All files 行时 functions 为 null', () => {
    const m = parseCoverageMetrics('no coverage table here');
    expect(m.functions).toBeNull();
    expect(m.lines).toBeNull();
  });

  it('parseCoveragePercent 为 lines 别名', () => {
    const output = 'All files | 80.00 | 85.50 |';
    expect(parseCoveragePercent(output)).toBe(85.5);
  });
});

describe('evaluateCoverageAgainstThresholds', () => {
  const thresholds = { lines: 80, functions: 80 };

  it('双指标均达标时 pass', () => {
    const r = evaluateCoverageAgainstThresholds({ lines: 82, functions: 81 }, thresholds);
    expect(r.pass).toBe(true);
    expect(r.message).toContain('达标');
  });

  it('Lines 不足时 fail', () => {
    const r = evaluateCoverageAgainstThresholds({ lines: 78, functions: 85 }, thresholds);
    expect(r.pass).toBe(false);
    expect(r.message).toContain('Lines 78%');
  });

  it('Funcs 不足时 fail', () => {
    const r = evaluateCoverageAgainstThresholds({ lines: 85, functions: 76 }, thresholds);
    expect(r.pass).toBe(false);
    expect(r.message).toContain('Funcs 76%');
  });

  it('双指标均不足时合并消息', () => {
    const r = evaluateCoverageAgainstThresholds({ lines: 70, functions: 65 }, thresholds);
    expect(r.pass).toBe(false);
    expect(r.message).toContain('Lines 70%');
    expect(r.message).toContain('Funcs 65%');
  });

  it('无法解析 metrics 时 fail', () => {
    const r = evaluateCoverageAgainstThresholds({ lines: null, functions: null }, thresholds);
    expect(r.pass).toBe(false);
    expect(r.message).toContain('无法解析');
  });
});

describe('DEFAULT_COVERAGE_THRESHOLDS', () => {
  it('默认 lines/functions 均为 80', () => {
    expect(DEFAULT_COVERAGE_THRESHOLDS).toEqual({ lines: 80, functions: 80 });
  });
});

describe('runCoverage', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/cov-test');
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('无 package.json 时 SKIP', () => {
    const r = runCoverage(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });
});
