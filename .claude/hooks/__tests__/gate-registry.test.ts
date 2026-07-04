import { describe, it, expect } from 'bun:test';
import {
  REGISTRY_COMMIT_TIMEOUT_MS,
  REGISTRY_FULL_TIMEOUT_MS,
  GATE_REGISTRY,
  listAllGatePaths,
  getRegistryNode,
  getRegistryDefaultTimeoutMs,
  getHookRootPath,
  getRegistryControlIds,
  nodeSupportsAutoFix,
  generateExampleYaml,
  AUTO_FIXABLE_CHECK_IDS,
  SECURITY_HOOK_IDS,
  CORE_MODULE_PATHS,
  SECURITY_MODULE_TEST_MAP,
  BLOCK_DANGEROUS_RULE_IDS,
} from '../gate-registry.js';

describe('gate-registry', () => {
  it('GATE_REGISTRY 含 ide 与 git 段', () => {
    expect(GATE_REGISTRY.ide).toBeDefined();
    expect(GATE_REGISTRY.git).toBeDefined();
  });

  it('listAllGatePaths 非空且含 pre-commit', () => {
    const paths = listAllGatePaths();
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.some((p) => p.includes('pre-commit'))).toBe(true);
  });

  it('getRegistryNode 解析 leaf check', () => {
    const node = getRegistryNode('git.pre-commit.checks.type-check');
    expect(node?.description).toBeTruthy();
  });

  it('getRegistryDefaultTimeoutMs 返回毫秒', () => {
    const ms = getRegistryDefaultTimeoutMs('git.pre-commit.checks.type-check');
    expect(ms === undefined || typeof ms === 'number').toBe(true);
  });

  it('getHookRootPath 截断 checks 后缀', () => {
    expect(getHookRootPath('git.pre-push.checks.semgrep')).toBe('git.pre-push');
    expect(getHookRootPath('git.pre-commit')).toBe('git.pre-commit');
  });

  it('getRegistryControlIds fintech checks', () => {
    const ids = getRegistryControlIds('git.pre-merge-commit.checks.sbom-archive');
    expect(ids?.length).toBeGreaterThan(0);
  });

  it('nodeSupportsAutoFix 仅 lint/format 类', () => {
    expect(nodeSupportsAutoFix('git.pre-commit.checks.format-staged-prettier')).toBe(true);
    expect(nodeSupportsAutoFix('git.pre-commit.checks.type-check')).toBe(false);
  });

  it('generateExampleYaml 含 settings 与 openapi-auth-negative', () => {
    const yaml = generateExampleYaml();
    expect(yaml).toContain('settings:');
    expect(yaml).toContain('coverageThreshold');
    expect(yaml).toContain('diffCoverageThreshold');
    expect(yaml).toContain('testFilePairing');
    expect(yaml).toContain('coreModuleCoverage');
    expect(yaml).toContain('securityRuleCoverage');
    expect(yaml).toContain('openapi-auth-negative');
  });

  it('SECURITY_HOOK_IDS 覆盖 §A 安全 hook', () => {
    expect(SECURITY_HOOK_IDS).toContain('block-dangerous-commands');
    expect(SECURITY_HOOK_IDS).toContain('git-ship-gate');
    expect(SECURITY_HOOK_IDS.length).toBe(9);
    for (const hookId of SECURITY_HOOK_IDS) {
      expect(SECURITY_MODULE_TEST_MAP[hookId]?.length).toBeGreaterThan(0);
    }
  });

  it('CORE_MODULE_PATHS 含质量门编排核心模块', () => {
    expect(CORE_MODULE_PATHS).toContain('quality-gate.ts');
    expect(CORE_MODULE_PATHS).toContain('checks/git-policy.ts');
    expect(CORE_MODULE_PATHS.length).toBe(6);
  });

  it('FULL_CHECKS 含覆盖率 v2.1 新 check', () => {
    const node = getRegistryNode('git.pre-push.checks.diff-coverage');
    expect(node?.description).toContain('L1b');
    expect(getRegistryNode('git.pre-push.checks.security-rule-coverage')?.description).toBeTruthy();
    expect(getRegistryNode('git.pre-push.checks.core-module-coverage')?.description).toBeTruthy();
    expect(getRegistryNode('git.pre-push.checks.full-test-sh')?.description).toBeTruthy();
  });

  it('PRE_COMMIT_CHECKS 含 test-file-pairing', () => {
    const node = getRegistryNode('git.pre-commit.checks.test-file-pairing');
    expect(node?.description).toContain('配对');
  });

  it('BLOCK_DANGEROUS_RULE_IDS 与 SECURITY_HOOK_IDS 独立 SSOT', () => {
    expect(BLOCK_DANGEROUS_RULE_IDS.length).toBeGreaterThan(40);
    expect(SECURITY_HOOK_IDS).not.toContain('session-start');
  });

  it('超时常量合理', () => {
    expect(REGISTRY_COMMIT_TIMEOUT_MS).toBe(300_000);
    expect(REGISTRY_FULL_TIMEOUT_MS).toBe(900_000);
  });

  it('AUTO_FIXABLE_CHECK_IDS 非空', () => {
    expect(AUTO_FIXABLE_CHECK_IDS.size).toBeGreaterThan(0);
  });
});
