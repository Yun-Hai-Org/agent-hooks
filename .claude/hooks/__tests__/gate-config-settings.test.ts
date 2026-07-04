import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  clearGateConfigCache,
  resolveCoverageThresholds,
  resolveScanScope,
  resolvePushMergeBranchPolicy,
  resolveLicenseDenylist,
  resolveDiffCoverageThreshold,
  resolveTestFilePairingConfig,
  resolveCoreModuleCoverageConfig,
  resolveSecurityRuleCoverageConfig,
  isDiffCoverageEnforcedFor,
  parseDuration,
  normalizeTimeout,
  formatGateTimeoutLabel,
  gateTimeoutMessage,
  isGateNodeEnabled,
  getGateNodeTimeout,
  isGateNodeAutoFixEnabled,
} from '../gate-config.js';
import { CORE_MODULE_PATHS, SECURITY_HOOK_IDS } from '../gate-registry.js';
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

  it('pushMergeBranches mode 与 include/exclude 合并', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  pushMergeBranches:
    mode: selected
    include:
      - feat/*
    exclude:
      - wip/*
`,
    );
    clearGateConfigCache();
    const policy = resolvePushMergeBranchPolicy(repoDir);
    expect(policy.mode).toBe('selected');
    expect(policy.include).toEqual(['feat/*']);
    expect(policy.exclude).toEqual(['wip/*']);
  });

  it('PROJECT_ROOT yaml 含 settings', () => {
    const t = resolveCoverageThresholds(PROJECT_ROOT);
    expect(t.lines).toBeGreaterThanOrEqual(79);
    expect(t.functions).toBeGreaterThanOrEqual(80);
  });

  it('无 yaml 时 diffCoverage 默认 push-only 80%', () => {
    const config = resolveDiffCoverageThreshold(repoDir);
    expect(config.lines).toBe(80);
    expect(config.enforceOn).toEqual(['push']);
    expect(config.scope).toBe('merge-base');
    expect(config.baseRef).toBe('auto');
    expect(config.include.length).toBeGreaterThan(0);
    expect(isDiffCoverageEnforcedFor('push', repoDir)).toBe(true);
    expect(isDiffCoverageEnforcedFor('commit', repoDir)).toBe(false);
  });

  it('diffCoverageThreshold 可从 yaml 覆盖', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  diffCoverageThreshold:
    lines: 85
    enforceOn:
      - push
    include:
      - src/**
`,
    );
    clearGateConfigCache();
    const config = resolveDiffCoverageThreshold(repoDir);
    expect(config.lines).toBe(85);
    expect(config.include).toContain('src/**');
  });

  it('无 yaml 时 testFilePairing 默认 commit 启用', () => {
    const config = resolveTestFilePairingConfig(repoDir);
    expect(config.enabled).toBe(true);
    expect(config.enforceOn).toEqual(['commit']);
    expect(config.sourceGlobs.some((g) => g.includes('.claude/hooks'))).toBe(true);
  });

  it('无 yaml 时 coreModuleCoverage 默认 90% 与 CORE_MODULE_PATHS', () => {
    const config = resolveCoreModuleCoverageConfig(repoDir);
    expect(config.lines).toBe(90);
    expect(config.functions).toBe(90);
    expect(config.paths).toEqual([...CORE_MODULE_PATHS]);
  });

  it('无 yaml 时 securityRuleCoverage 默认 100% 与 SECURITY_HOOK_IDS', () => {
    const config = resolveSecurityRuleCoverageConfig(repoDir);
    expect(config.requiredPercent).toBe(100);
    expect(config.modules).toEqual([...SECURITY_HOOK_IDS]);
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
