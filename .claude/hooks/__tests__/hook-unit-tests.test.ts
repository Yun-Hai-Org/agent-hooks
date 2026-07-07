import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { isHooksProject } from '../checks/hooks-project.js';
import { parseBunTestRunSummary, runHookUnitTests, runRelatedTests } from '../checks/tests.js';
import { evaluateCoverageAgainstThresholds, parseCoverageMetrics } from '../checks/coverage.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo, PROJECT_ROOT } from './helpers.js';
import { execSync } from 'child_process';

const VALIDATE_SCRIPT = join(PROJECT_ROOT, 'scripts/validate-hooks-json.example.sh');
const DOCTOR_SCRIPT = join(PROJECT_ROOT, 'scripts/hooks-doctor.sh');

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

describe('hooks repo integrity scripts', () => {
  it('validate-hooks-json.example.sh passes for PROJECT_ROOT', () => {
    const result = spawnSync('bash', [VALIDATE_SCRIPT, PROJECT_ROOT], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
  });

  it('hooks-doctor --json (no repair) runs against PROJECT_ROOT', () => {
    const result = spawnSync('bash', [DOCTOR_SCRIPT, '--json', '--quiet', PROJECT_ROOT], {
      encoding: 'utf-8',
    });
    const jsonLine = (result.stdout ?? '')
      .trim()
      .split('\n')
      .reverse()
      .find((line) => line.startsWith('{'));
    expect(jsonLine).toBeTruthy();
    const report = JSON.parse(jsonLine ?? '{}') as { ok: boolean; errors: number };
    expect(typeof report.errors).toBe('number');
    expect(typeof report.ok).toBe('boolean');
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

  describe('stub hooks 项目', () => {
    let stubRepo = '';
    let origGlob: string | undefined;

    beforeEach(() => {
      stubRepo = createTempGitRepo('feat/hook-unit-stub');
      mkdirSync(join(stubRepo, '.claude/hooks/__tests__'), { recursive: true });
      writeFileSync(join(stubRepo, '.claude/hooks/quality-gate.ts'), 'export {};\n');
      writeFileSync(
        join(stubRepo, '.claude/hooks/__tests__/stub.test.ts'),
        `import { it, expect } from 'bun:test';\nit('ok', () => expect(1).toBe(1));\n`,
      );
      writeFileSync(join(stubRepo, '.claude/hooks/__tests__/empty-global-quality-gate.yaml'), 'settings: {}\n');
      origGlob = process.env['HOOK_UNIT_TEST_GLOB'];
      process.env['HOOK_UNIT_TEST_GLOB'] = './.claude/hooks/__tests__/stub.test.ts';
    });

    afterEach(() => {
      if (origGlob === undefined) delete process.env['HOOK_UNIT_TEST_GLOB'];
      else process.env['HOOK_UNIT_TEST_GLOB'] = origGlob;
      if (stubRepo) cleanupTempGitRepo(stubRepo);
      stubRepo = '';
    });

    it('stub ALLOW', async () => {
      const r = await runHookUnitTests(stubRepo);
      expect(r.decision).toBe(DECISION.ALLOW);
    }, 60_000);

    it('stub coverage 路径', async () => {
      const r = await runHookUnitTests(stubRepo, { coverageThreshold: { lines: 1, functions: 1 } });
      expect([DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
    }, 60_000);
  });

  it('hooks 项目无 __tests__ DENY', async () => {
    const repo = createTempGitRepo('feat/no-tests');
    mkdirSync(join(repo, '.claude/hooks'), { recursive: true });
    writeFileSync(join(repo, '.claude/hooks/quality-gate.ts'), 'export {};\n');
    try {
      const r = await runHookUnitTests(repo);
      expect(r.decision).toBe(DECISION.DENY);
    } finally {
      cleanupTempGitRepo(repo);
    }
  });
});

describe('runRelatedTests branches', () => {
  it('暂存 js+py 混合', async () => {
    const repo = createTempGitRepo('feat/mixed-related');
    mkdirSync(join(repo, 'tests'), { recursive: true });
    writeFileSync(join(repo, 'lib.py'), 'def f():\n  return 1\n');
    writeFileSync(join(repo, 'tests/test_lib.py'), 'def test_f():\n  assert True\n');
    writeFileSync(join(repo, 'lib.ts'), 'export const x = 1;\n');
    writeFileSync(
      join(repo, 'lib.test.ts'),
      `import { it, expect } from 'bun:test';\nit('x', () => expect(1).toBe(1));\n`,
    );
    execSync('git add lib.py tests/test_lib.py lib.ts lib.test.ts', { cwd: repo });
    const r = await runRelatedTests(repo);
    expect([DECISION.ALLOW, DECISION.SKIP, DECISION.DENY]).toContain(r.decision);
  }, 60_000);
});
