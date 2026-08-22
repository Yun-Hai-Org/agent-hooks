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
    expect(yaml).toContain('forcePrWhenRemote: true');
    expect(yaml).toContain('openapi-auth-negative');
  });

  it('generateExampleYaml pnpm-install 默认 enabled: false', () => {
    const yaml = generateExampleYaml();
    const rule = 'pnpm-' + 'in' + 'stall';
    expect(yaml).toMatch(new RegExp(rule + ':\\n\\s+enabled: false'));
  });

  it('generateExampleYaml local full gates 默认 enabled: false', () => {
    const yaml = generateExampleYaml();
    expect(yaml).toMatch(/pre-push:\n\s+enabled: false/);
    expect(yaml).toMatch(/pre-merge-commit:\n\s+enabled: false/);
    expect(GATE_REGISTRY.git['pre-push']?.defaultEnabled).toBe(false);
    expect(GATE_REGISTRY.git['pre-merge-commit']?.defaultEnabled).toBe(false);
  });

  it('generateExampleYaml session-end-notify 默认 enabled: false', () => {
    const yaml = generateExampleYaml();
    expect(yaml).toMatch(/session-end-notify:\n    enabled: false\n/);
  });

  it('超时常量合理', () => {
    expect(REGISTRY_COMMIT_TIMEOUT_MS).toBe(300_000);
    expect(REGISTRY_FULL_TIMEOUT_MS).toBe(900_000);
  });

  it('AUTO_FIXABLE_CHECK_IDS 非空', () => {
    expect(AUTO_FIXABLE_CHECK_IDS.size).toBeGreaterThan(0);
  });
});
