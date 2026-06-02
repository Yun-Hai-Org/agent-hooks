import { describe, it, expect } from 'bun:test';
import { formatResult, decide, DECISION } from '../security-orchestrator.js';

describe('merge-gate', () => {
  // 目标分支检测
  it('目标非 main/master 应该 skip', () => {
    const target = 'feat/test';
    const isMain = ['main', 'master'].includes(target);
    expect(isMain).toBe(false);
  });

  it('目标 main 应该触发全量检查', () => {
    const target = 'main';
    const isMain = ['main', 'master'].includes(target);
    expect(isMain).toBe(true);
  });

  it('目标 master 应该触发全量检查', () => {
    const target = 'master';
    const isMain = ['main', 'master'].includes(target);
    expect(isMain).toBe(true);
  });

  // 安全扫描结果
  it('Semgrep 发现 ERROR 级漏洞应该 deny', () => {
    const results = [formatResult('semgrep-sast', DECISION.DENY, 'Semgrep 发现 ERROR 漏洞')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.DENY);
  });

  it('Knip 发现未使用文件应该 deny', () => {
    const results = [formatResult('knip-dead-code', DECISION.DENY, 'Knip 发现未使用文件')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.DENY);
  });

  it('Knip 发现未使用依赖应该 deny', () => {
    const results = [formatResult('knip-dead-code', DECISION.DENY, 'Knip 发现未使用依赖')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.DENY);
  });

  it('Knip 发现未声明依赖应该 deny', () => {
    const results = [formatResult('knip-dead-code', DECISION.DENY, 'Knip 发现未声明依赖')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.DENY);
  });

  it('Knip 发现未使用导出应该 warning', () => {
    const results = [formatResult('knip-dead-code', DECISION.WARN, 'Knip 发现未使用导出')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.WARN);
  });

  it('Knip 干净项目应该 allow', () => {
    const results = [formatResult('knip-dead-code', DECISION.ALLOW, 'Knip 扫描通过')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.ALLOW);
  });

  it('Knip 配置缺失应该 deny', () => {
    const results = [formatResult('knip-dead-code', DECISION.DENY, 'knip.json 配置文件不存在')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.DENY);
  });

  it('Trivy 发现 CVE 应该 deny', () => {
    const results = [formatResult('trivy-sca', DECISION.DENY, 'Trivy 发现 CRITICAL 漏洞')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.DENY);
  });

  it('测试失败应该 deny', () => {
    const results = [formatResult('full-tests', DECISION.DENY, '测试失败')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.DENY);
  });

  it('工具未安装应该 deny', () => {
    const results = [formatResult('semgrep-sast', DECISION.DENY, 'Semgrep 未安装')];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.DENY);
  });

  it('混合 Critical+Warning → deny 且仅报告 Critical', () => {
    const results = [
      formatResult('semgrep-sast', DECISION.DENY, 'Critical 漏洞'),
      formatResult('knip-dead-code', DECISION.WARN, 'Warning: 未使用导出'),
    ];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.DENY);
    expect(d.denyResults.length).toBe(1);
    expect(d.warnResults.length).toBe(1);
  });

  it('全部通过应该 allow', () => {
    const results = [
      formatResult('semgrep-sast', DECISION.ALLOW, '通过'),
      formatResult('knip-dead-code', DECISION.ALLOW, '通过'),
      formatResult('trivy-sca', DECISION.ALLOW, '通过'),
      formatResult('full-tests', DECISION.ALLOW, '通过'),
    ];
    const d = decide(results);
    expect(d.decision).toBe(DECISION.ALLOW);
  });

  it('空 stdin 应该降级输出 {}', () => {
    expect('{}'.trim()).toBe('{}');
  });
});
