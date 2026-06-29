import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  clearGateConfigCache,
  resolveCoverageThresholds,
  resolveScanScope,
  resolveLicenseDenylist,
  parseDuration,
  normalizeTimeout,
  formatGateTimeoutLabel,
  gateTimeoutMessage,
  isGateNodeEnabled,
  getGateNodeTimeout,
  isGateNodeAutoFixEnabled,
} from '../gate-config.js';
import { createTempGitRepo, cleanupTempGitRepo, PROJECT_ROOT } from './helpers.js';

describe('gate-config settings', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/settings');
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('无 yaml 时 coverage 默认 80/80', () => {
    expect(resolveCoverageThresholds(repoDir)).toEqual({ lines: 80, functions: 80 });
  });

  it('coverageThreshold 简写数字', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(join(repoDir, '.claude/quality-gate.yaml'), 'settings:\n  coverageThreshold: 75\n');
    clearGateConfigCache();
    expect(resolveCoverageThresholds(repoDir)).toEqual({ lines: 75, functions: 75 });
  });

  it('coverageThreshold 分项配置', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  coverageThreshold:
    lines: 85
    functions: 70
`,
    );
    clearGateConfigCache();
    expect(resolveCoverageThresholds(repoDir)).toEqual({ lines: 85, functions: 70 });
  });

  it('licenseDenylist 从 yaml 读取', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  licenseDenylist:
    - GPL-3.0
    - AGPL-3.0
`,
    );
    clearGateConfigCache();
    expect(resolveLicenseDenylist(repoDir)).toEqual(['GPL-3.0', 'AGPL-3.0']);
  });

  it('scanScope include 从 yaml 读取', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  scanScope:
    include:
      - src/
`,
    );
    clearGateConfigCache();
    expect(resolveScanScope(repoDir).include).toEqual(['src/']);
  });

  it('PROJECT_ROOT yaml 含 settings', () => {
    const t = resolveCoverageThresholds(PROJECT_ROOT);
    expect(t.lines).toBeGreaterThanOrEqual(80);
    expect(t.functions).toBeGreaterThanOrEqual(80);
  });
});

describe('parseDuration', () => {
  it('解析 s/m/h/ms 与纯数字', () => {
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration(120000)).toBe(120_000);
  });

  it('非法 duration 抛错', () => {
    expect(() => parseDuration('not-a-duration')).toThrow();
  });
});

describe('normalizeTimeout', () => {
  it('timeoutMs 优先', () => {
    expect(normalizeTimeout({ timeoutMs: 5000 })).toBe(5000);
  });

  it('timeout 字符串解析', () => {
    expect(normalizeTimeout({ timeout: '2m' })).toBe(120_000);
  });
});

describe('formatGateTimeoutLabel', () => {
  it('格式化毫秒为可读标签', () => {
    expect(formatGateTimeoutLabel(90_000)).toContain('90');
    expect(gateTimeoutMessage('bun test', 60_000)).toContain('bun test');
  });
});

describe('gate node helpers', () => {
  it('PROJECT_ROOT pre-commit 节点可查询', () => {
    expect(typeof isGateNodeEnabled('git.pre-commit', PROJECT_ROOT)).toBe('boolean');
    const timeout = getGateNodeTimeout('git.pre-commit.checks.type-check', PROJECT_ROOT);
    expect(timeout === undefined || typeof timeout === 'number').toBe(true);
    expect(typeof isGateNodeAutoFixEnabled('git.pre-commit', PROJECT_ROOT)).toBe('boolean');
  });
});
