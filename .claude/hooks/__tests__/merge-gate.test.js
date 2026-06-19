import { describe, it, expect } from 'bun:test';
import { formatResult, decide, DECISION } from '../security-orchestrator.js';
import { extractMergeTarget, getCurrentBranch } from '../merge-gate.js';
import { summarizeResults } from '../quality-gate.js';

describe('merge-gate', () => {
  describe('extractMergeTarget', () => {
    it('应该从 git merge main 中提取 main', () => {
      expect(extractMergeTarget('git merge main')).toBe('main');
    });

    it('应该从 git merge feat/xxx 中提取 feat/xxx', () => {
      expect(extractMergeTarget('git merge feat/xxx')).toBe('feat/xxx');
    });

    it('应该处理带 --no-ff 的合并命令', () => {
      expect(extractMergeTarget('git merge --no-ff feat/xxx')).toBe('feat/xxx');
    });

    it('无法提取时应该返回 null', () => {
      expect(extractMergeTarget('git merge')).toBe(null);
    });
  });

  describe('getCurrentBranch', () => {
    it('应该返回字符串或 null', () => {
      const branch = getCurrentBranch(process.cwd());
      expect(branch === null || typeof branch === 'string').toBe(true);
    });
  });

  describe('决策逻辑', () => {
    it('Semgrep ERROR 应该 deny', () => {
      const results = [formatResult('semgrep', DECISION.DENY, 'Semgrep 发现 ERROR 漏洞')];
      expect(decide(results).decision).toBe(DECISION.DENY);
    });

    it('全部 allow/skip 应该 allow', () => {
      const results = [
        formatResult('type-check', DECISION.ALLOW, '通过'),
        formatResult('semgrep', DECISION.SKIP, '跳过'),
      ];
      expect(decide(results).decision).toBe(DECISION.ALLOW);
    });
  });

  describe('summarizeResults', () => {
    it('应该生成可读摘要', () => {
      const summary = summarizeResults([formatResult('semgrep', DECISION.ALLOW, 'Semgrep 扫描通过')]);
      expect(summary).toContain('semgrep');
      expect(summary).toContain('✅');
    });
  });
});
