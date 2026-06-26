import { describe, it, expect } from 'bun:test';
import { runPyDepAudit, osvHasVulnerabilities, pipAuditHasVulnerabilities } from '../checks/py-dep-audit.js';
import { DECISION } from '../security-orchestrator.js';
import { PROJECT_ROOT } from './helpers.js';

describe('py-dep-audit', () => {
  it('无 pyproject.toml 时 SKIP', async () => {
    const result = await runPyDepAudit('/tmp/nonexistent-pyproject-dir');
    expect(result.decision).toBe(DECISION.SKIP);
  });

  it('本项目无 Python 运行时依赖时 SKIP', async () => {
    const result = await runPyDepAudit(PROJECT_ROOT);
    expect(result.checkId).toBe('py-dep-audit');
    expect(result.decision).toBe(DECISION.SKIP);
    expect(result.message).toContain('无 Python 运行时依赖');
  });

  describe('osvHasVulnerabilities', () => {
    it('有 vulnerabilities 返回 true', () => {
      const json = JSON.stringify({ results: [{ packages: [{ vulnerabilities: [{ id: 'X' }] }] }] });
      expect(osvHasVulnerabilities(json)).toBe(true);
    });
    it('无 vulnerabilities 返回 false', () => {
      const json = JSON.stringify({ results: [{ packages: [{ vulnerabilities: [] }] }] });
      expect(osvHasVulnerabilities(json)).toBe(false);
    });
    it('空 results 返回 false', () => {
      expect(osvHasVulnerabilities(JSON.stringify({ results: [] }))).toBe(false);
    });
    it('不可解析返回 null（fail-closed）', () => {
      expect(osvHasVulnerabilities('not json')).toBeNull();
    });
  });

  describe('pipAuditHasVulnerabilities', () => {
    it('dependencies 结构中有 vulns 返回 true', () => {
      const json = JSON.stringify({ dependencies: [{ name: 'pkg', vulns: [{ id: 'PYSEC' }] }] });
      expect(pipAuditHasVulnerabilities(json)).toBe(true);
    });
    it('裸数组结构无 vulns 返回 false', () => {
      const json = JSON.stringify([{ name: 'pkg', vulns: [] }]);
      expect(pipAuditHasVulnerabilities(json)).toBe(false);
    });
    it('不可解析返回 null（fail-closed）', () => {
      expect(pipAuditHasVulnerabilities('<<<')).toBeNull();
    });
  });
});
