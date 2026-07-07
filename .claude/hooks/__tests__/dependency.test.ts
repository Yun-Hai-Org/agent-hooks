import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseBunAuditSeverities,
  evaluateBunAudit,
  runDepAudit,
  resolveJsDepAuditCwd,
  mergeSeverityCounts,
  getDepAuditProcessEnv,
  NPM_AUDIT_REGISTRY,
  isRegistryAuditFailure,
  registryAuditFailureMessage,
} from '../checks/dependency.js';
import { DECISION, formatResult } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('parseBunAuditSeverities', () => {
  it('解析 metadata.vulnerabilities', () => {
    const json = JSON.stringify({ metadata: { vulnerabilities: { critical: 1, high: 2, moderate: 0, low: 3 } } });
    expect(parseBunAuditSeverities(json)).toEqual({ critical: 1, high: 2, moderate: 0, low: 3 });
  });

  it('解析 Bun 原生 package -> advisories 格式', () => {
    const json = JSON.stringify({
      lodash: [{ severity: 'high' }, { severity: 'moderate' }],
      chalk: [{ severity: 'low' }],
    });
    expect(parseBunAuditSeverities(json)).toEqual({
      critical: 0,
      high: 1,
      moderate: 1,
      low: 1,
      info: 0,
    });
  });

  it('空对象表示无漏洞', () => {
    expect(parseBunAuditSeverities('{}')).toEqual({});
  });

  it('缺少可识别结构返回 null', () => {
    expect(parseBunAuditSeverities(JSON.stringify({ foo: 1 }))).toBeNull();
  });

  it('不可解析返回 null', () => {
    expect(parseBunAuditSeverities('audit request failed (status 404)')).toBeNull();
  });

  it('JSON 在 stderr 时可解析', () => {
    const json = JSON.stringify({ metadata: { vulnerabilities: { low: 1 } } });
    expect(parseBunAuditSeverities('', json)).toEqual({ low: 1 });
  });
});

describe('mergeSeverityCounts', () => {
  it('合并多个 audit 根目录的计数', () => {
    expect(
      mergeSeverityCounts(
        { critical: 0, high: 1, moderate: 0, low: 0, info: 0 },
        { critical: 0, high: 0, moderate: 2, low: 1, info: 0 },
      ),
    ).toEqual({ critical: 0, high: 1, moderate: 2, low: 1, info: 0 });
  });
});

describe('resolveJsDepAuditCwd', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      cleanupTempGitRepo(tmpDir);
      tmpDir = undefined;
    }
  });

  it('cwd 有 package.json 时返回 cwd', () => {
    tmpDir = join(tmpdir(), `dep-audit-root-${String(Date.now())}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), '{}');
    expect(resolveJsDepAuditCwd(tmpDir)).toEqual([tmpDir]);
  });

  it('monorepo 从 staged 路径解析子包根', () => {
    tmpDir = join(tmpdir(), `dep-audit-mono-${String(Date.now())}`);
    const pkgDir = join(tmpDir, 'apps', 'web');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), '{}');
    expect(resolveJsDepAuditCwd(tmpDir, ['apps/web/package.json'])).toEqual([pkgDir]);
  });

  it('无 package.json 且无 staged 触发路径时返回空', () => {
    tmpDir = join(tmpdir(), `dep-audit-empty-${String(Date.now())}`);
    mkdirSync(tmpDir, { recursive: true });
    expect(resolveJsDepAuditCwd(tmpDir)).toEqual([]);
    expect(resolveJsDepAuditCwd(tmpDir, ['README.md'])).toEqual([]);
  });
});

describe('registry audit helpers', () => {
  it('识别 registry 404 失败', () => {
    expect(isRegistryAuditFailure('', 'error: audit request failed (status 404)')).toBe(true);
  });

  it('生成含 status 的错误消息', () => {
    expect(registryAuditFailureMessage('', 'audit request failed (status 404)')).toContain('status 404');
  });

  it('getDepAuditProcessEnv 强制 npmjs registry', () => {
    expect(getDepAuditProcessEnv().NPM_CONFIG_REGISTRY).toBe(NPM_AUDIT_REGISTRY);
  });
});

describe('evaluateBunAudit', () => {
  it('有 moderate+ 漏洞应 DENY', () => {
    expect(evaluateBunAudit({ critical: 0, high: 0, moderate: 1 }).decision).toBe(DECISION.DENY);
    expect(evaluateBunAudit({ critical: 2 }).decision).toBe(DECISION.DENY);
  });
  it('仅 low/info 不阻断，应 ALLOW', () => {
    expect(evaluateBunAudit({ low: 5, info: 9 }).decision).toBe(DECISION.ALLOW);
  });
  it('全 0 应 ALLOW', () => {
    expect(evaluateBunAudit({}).decision).toBe(DECISION.ALLOW);
  });
});

describe('runDepAudit staged 触发', () => {
  let repoDir: string | undefined;
  afterEach(() => {
    if (repoDir) {
      cleanupTempGitRepo(repoDir);
      repoDir = undefined;
    }
  });
  it('暂存区无依赖文件应 SKIP', async () => {
    repoDir = createTempGitRepo('feature');
    const result = await runDepAudit(repoDir, { staged: true });
    expect(result.decision).toBe(DECISION.SKIP);
  });

  it('monorepo staged 依赖文件但无 package 根应 SKIP', async () => {
    repoDir = createTempGitRepo('feature');
    mkdirSync(join(repoDir, 'apps', 'web'), { recursive: true });
    writeFileSync(join(repoDir, 'apps', 'web', 'bun.lock'), '{}');
    const { execSync } = await import('child_process');
    execSync('git add apps/web/bun.lock', { cwd: repoDir });
    const result = await runDepAudit(repoDir, { staged: true });
    expect(result.decision).toBe(DECISION.SKIP);
    expect(result.message).toContain('无可用 JS package 根');
  });
});

describe('runDepAudit fail-closed', () => {
  it('不可解析 audit JSON 应对应 DENY 决策路径', () => {
    expect(parseBunAuditSeverities('audit request failed (status 404)')).toBeNull();
    const simulated = formatResult('dep-audit', DECISION.DENY, '依赖审计输出不可解析，按失败处理（fail-closed）');
    expect(simulated.decision).toBe(DECISION.DENY);
  });
});
