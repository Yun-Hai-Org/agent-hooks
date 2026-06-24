import { describe, it, expect } from 'bun:test';
import { evaluateTrivyJson } from '../checks/security-scan.js';
import { DECISION } from '../security-orchestrator.js';

describe('evaluateTrivyJson', () => {
  it('发现 CRITICAL/HIGH/MEDIUM 漏洞应 DENY', () => {
    const json = JSON.stringify({
      Results: [{ Vulnerabilities: [{ Severity: 'HIGH' }, { Severity: 'MEDIUM' }] }],
    });
    const r = evaluateTrivyJson(json);
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('漏洞');
  });

  it('发现不合规 license（HIGH）应 DENY', () => {
    const json = JSON.stringify({
      Results: [{ Licenses: [{ Severity: 'HIGH', Name: 'GPL-3.0', PkgName: 'foo' }] }],
    });
    const r = evaluateTrivyJson(json);
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('license');
  });

  it('仅 LOW license 不阻断，应 ALLOW', () => {
    const json = JSON.stringify({
      Results: [{ Licenses: [{ Severity: 'LOW', Name: 'MIT', PkgName: 'bar' }] }],
    });
    expect(evaluateTrivyJson(json).decision).toBe(DECISION.ALLOW);
  });

  it('无漏洞无 license 问题应 ALLOW', () => {
    expect(evaluateTrivyJson(JSON.stringify({ Results: [] })).decision).toBe(DECISION.ALLOW);
  });

  it('输出不可解析应 fail-closed DENY', () => {
    const r = evaluateTrivyJson('not-json');
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('无法解析');
  });
});
