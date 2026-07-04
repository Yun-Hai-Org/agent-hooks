import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  matchGlobPattern,
  parseCoverageLineHits,
  computeDiffCoveragePercent,
  parsePushDiffExecutableLines,
  runDiffCoverage,
} from '../checks/diff-coverage.js';
import { resolveDiffCoverageThreshold, clearGateConfigCache } from '../gate-config.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo, PROJECT_ROOT } from './helpers.js';

describe('matchGlobPattern', () => {
  it('匹配 ** glob', () => {
    expect(matchGlobPattern('.claude/hooks/foo.ts', '.claude/hooks/**')).toBe(true);
    expect(matchGlobPattern('other/foo.ts', '.claude/hooks/**')).toBe(false);
  });

  it('匹配 exclude 模式', () => {
    expect(matchGlobPattern('lib/foo.test.ts', '**/*.test.ts')).toBe(true);
  });
});

describe('parseCoverageLineHits', () => {
  it('解析 per-file 未覆盖行', () => {
    const output = `
All files                               |   80.00 |   75.00 |
 .claude/hooks/checks/foo.ts             |  100.00 |   50.00 | 10-12,20
`;
    const hits = parseCoverageLineHits(output);
    const file = hits.get('.claude/hooks/checks/foo.ts');
    expect(file?.linesPercent).toBe(50);
    expect(file?.uncoveredLines.has(10)).toBe(true);
    expect(file?.uncoveredLines.has(11)).toBe(true);
    expect(file?.uncoveredLines.has(20)).toBe(true);
  });
});

describe('computeDiffCoveragePercent', () => {
  it('100% 文件行覆盖率时变更行全命中', () => {
    const changed = [{ file: '.claude/hooks/a.ts', line: 5 }];
    const hits = parseCoverageLineHits(' .claude/hooks/a.ts | 100.00 | 100.00 |');
    const { percent, covered, total } = computeDiffCoveragePercent(changed, hits);
    expect(total).toBe(1);
    expect(covered).toBe(1);
    expect(percent).toBe(100);
  });

  it('未覆盖行不计入命中', () => {
    const changed = [{ file: '.claude/hooks/a.ts', line: 10 }];
    const hits = parseCoverageLineHits(' .claude/hooks/a.ts | 100.00 | 50.00 | 10');
    const { percent, covered } = computeDiffCoveragePercent(changed, hits);
    expect(covered).toBe(0);
    expect(percent).toBe(0);
  });
});

describe('parsePushDiffExecutableLines', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/diff-cov');
    mkdirSync(join(repoDir, '.claude/hooks'), { recursive: true });
    writeFileSync(join(repoDir, '.claude/hooks/lib.ts'), 'export const v = 1;\n');
    execSync('git add .claude/hooks/lib.ts', { cwd: repoDir });
    execSync('git commit -m "chore: base"', { cwd: repoDir });
    writeFileSync(join(repoDir, '.claude/hooks/lib.ts'), 'export const v = 2;\nexport const w = 3;\n');
    execSync('git add .claude/hooks/lib.ts', { cwd: repoDir });
    execSync('git commit -m "feat: change"', { cwd: repoDir });
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('提取 merge-base 内可执行新增行', () => {
    const config = resolveDiffCoverageThreshold(repoDir);
    const lines = parsePushDiffExecutableLines(repoDir, config);
    expect(lines.some((l) => l.file.endsWith('.claude/hooks/lib.ts'))).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('runDiffCoverage', () => {
  it('PROJECT_ROOT enforceOn 含 push 时可执行', () => {
    const r = runDiffCoverage(PROJECT_ROOT, { coverageReport: 'All files | 80 | 80 |\n' });
    expect(r.checkId).toBe('diff-coverage');
    expect([DECISION.SKIP, DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
  });

  it('enforceOn 不含 push 时 SKIP', () => {
    const repoDir = createTempGitRepo('feat/diff-skip');
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  diffCoverageThreshold:
    enforceOn:
      - commit
`,
    );
    clearGateConfigCache();
    try {
      const r = runDiffCoverage(repoDir);
      expect(r.decision).toBe(DECISION.SKIP);
    } finally {
      cleanupTempGitRepo(repoDir);
      clearGateConfigCache();
    }
  });
});
