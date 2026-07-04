import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  clearGateConfigCache,
  loadGateConfig,
  resolveCoverageThresholds,
  resolveDiffCoverageThreshold,
  resolveTestFilePairingConfig,
  resolveCoreModuleCoverageConfig,
  resolveSecurityRuleCoverageConfig,
  resolveScanScope,
  resolvePushMergeBranchPolicy,
  resolveLicenseDenylist,
} from '../gate-config.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

const GLOBAL_FIXTURE = join(import.meta.dir, 'fixtures/global-quality-gate-settings.yaml');

describe('gate-config deep merge with global fixture', () => {
  let repoDir = '';

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/deep-merge');
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = GLOBAL_FIXTURE;
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
  });

  it('global settings 基线可读', () => {
    expect(resolveCoverageThresholds(repoDir).lines).toBe(80);
    expect(resolveDiffCoverageThreshold(repoDir).lines).toBe(80);
    expect(resolveTestFilePairingConfig(repoDir).enabled).toBe(true);
    expect(resolveCoreModuleCoverageConfig(repoDir).lines).toBe(90);
    expect(resolveSecurityRuleCoverageConfig(repoDir).requiredPercent).toBe(100);
    expect(resolveScanScope(repoDir).include?.length).toBeGreaterThan(0);
    expect(resolvePushMergeBranchPolicy(repoDir).mode).toBe('all');
    expect(resolveLicenseDenylist(repoDir)).toContain('GPL-3.0');
  });

  it('仓库 yaml 覆盖 global settings 各 merge 分支', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  coverageThreshold:
    lines: 85
    functions: 75
  diffCoverageThreshold:
    lines: 82
    enforceOn:
      - push
    include:
      - src/**
    exclude:
      - vendor/**
  testFilePairing:
    enabled: false
    enforceOn:
      - commit
    sourceGlobs:
      - lib/**
    exclude:
      - lib/generated/**
  coreModuleCoverage:
    lines: 91
    functions: 88
    paths:
      - quality-gate.ts
  securityRuleCoverage:
    requiredPercent: 100
    modules:
      - block-dangerous-commands
      - protect-secrets
  scanScope:
    include:
      - app/**
    exclude:
      - dist/**
  pushMergeBranches:
    mode: selected
    include:
      - feat/*
    exclude:
      - feat/wip/*
  licenseDenylist:
    - MIT
  notifications:
    channels:
      wechat:
        url: https://repo.example/wechat
      feishu:
        url: https://repo.example/feishu
git:
  pre-commit:
    enabled: true
    autoFix: true
    checks:
      branch-check:
        enabled: false
      type-check:
        enabled: true
  pre-push:
    enabled: true
    checks:
      hook-unit-tests:
        enabled: false
ide:
  workflow-gate:
    enabled: false
`,
    );
    clearGateConfigCache();
    const config = loadGateConfig(repoDir);
    expect(resolveCoverageThresholds(repoDir)).toEqual({ lines: 85, functions: 75 });
    expect(resolveDiffCoverageThreshold(repoDir).include).toContain('src/**');
    expect(resolveDiffCoverageThreshold(repoDir).exclude).toContain('vendor/**');
    expect(resolveTestFilePairingConfig(repoDir).enabled).toBe(false);
    expect(resolveTestFilePairingConfig(repoDir).sourceGlobs).toContain('lib/**');
    expect(resolveCoreModuleCoverageConfig(repoDir).paths).toEqual(['quality-gate.ts']);
    expect(resolveSecurityRuleCoverageConfig(repoDir).modules).toContain('protect-secrets');
    expect(resolveScanScope(repoDir).include).toContain('app/**');
    expect(resolveScanScope(repoDir).exclude).toContain('dist/**');
    expect(resolvePushMergeBranchPolicy(repoDir).mode).toBe('selected');
    expect(resolveLicenseDenylist(repoDir)).toEqual(expect.arrayContaining(['GPL-3.0', 'MIT']));
    expect(config.settings?.notifications?.channels?.wechat?.url).toBe('https://repo.example/wechat');
    expect(config.settings?.notifications?.channels?.feishu?.url).toBe('https://repo.example/feishu');
    expect(config.git?.['pre-commit']?.autoFix).toBe(true);
    expect(config.git?.['pre-commit']?.checks?.['branch-check']?.enabled).toBe(false);
    expect(config.git?.['pre-push']?.checks?.['hook-unit-tests']?.enabled).toBe(false);
    expect(config.ide?.['workflow-gate']?.enabled).toBe(false);
  });
});
