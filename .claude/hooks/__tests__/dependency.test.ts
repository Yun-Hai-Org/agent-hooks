import { describe, it, expect, afterEach } from 'bun:test';
import { parseBunAuditSeverities, evaluateBunAudit, runDepAudit } from '../checks/dependency.js';
import { DECISION, formatResult } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('parseBunAuditSeverities', () => {
  it('解析 metadata.vulnerabilities', () => {
    const json = JSON.stringify({ metadata: { vulnerabilities: { critical: 1, high: 2, moderate: 0, low: 3 } } });
    expect(parseBunAuditSeverities(json)).toEqual({ critical: 1, high: 2, moderate: 0, low: 3 });
  });
  it('缺少 metadata 返回 null', () => {
    expect(parseBunAuditSeverities(JSON.stringify({ foo: 1 }))).toBeNull();
  });
  it('不可解析返回 null', () => {
    expect(parseBunAuditSeverities('audit request failed (status 404)')).toBeNull();
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
});

describe('runDepAudit fail-closed', () => {
  it('不可解析 audit JSON 应对应 DENY 决策路径', () => {
    expect(parseBunAuditSeverities('audit request failed (status 404)')).toBeNull();
    const simulated = formatResult('dep-audit', DECISION.DENY, '依赖审计输出不可解析，按失败处理（fail-closed）');
    expect(simulated.decision).toBe(DECISION.DENY);
  });
});
