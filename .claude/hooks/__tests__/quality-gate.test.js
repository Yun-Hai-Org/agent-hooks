import { describe, it, expect } from 'bun:test';
import {
  parseArgs,
  runQualityGate,
  formatChecksForLog,
  summarizeCheckDetails,
  formatCheckSummaryLine,
} from '../quality-gate.js';
import { DECISION, formatResult } from '../security-orchestrator.js';
import { checkBranch, checkCommitMessage } from '../checks/git-policy.js';

describe('quality-gate', () => {
  describe('parseArgs', () => {
    it('应解析 profile 与 cwd', () => {
      const opts = parseArgs(['--profile=commit', '--cwd=/tmp', '--json']);
      expect(opts.profile).toBe('commit');
      expect(opts.cwd).toBe('/tmp');
      expect(opts.json).toBe(true);
    });
  });

  describe('commit profile', () => {
    it('错误 commit message 应 deny', () => {
      const r = checkCommitMessage('git commit -m "bad message"');
      expect(r.decision).toBe(DECISION.DENY);
    });

    it('正确 commit message 应 allow', () => {
      const r = checkCommitMessage('git commit -m "feat: add hook"');
      expect(r.decision).toBe(DECISION.ALLOW);
    });
  });

  describe('runQualityGate commit smoke', () => {
    it('非 git 目录应可运行（skip 多项）', async () => {
      const result = await runQualityGate({
        profile: 'commit',
        cwd: '/tmp',
        commitCmd: 'git commit -m "feat: test"',
      });
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('results');
    });
  });

  describe('gate logging helpers', () => {
    it('formatChecksForLog 应包含 details 摘要', () => {
      const results = [
        formatResult('type-check', DECISION.DENY, '类型检查失败', {
          failures: [{ tool: 'tsc', stdout: '.claude/hooks/x.js(1,1): error TS1005', stderr: '' }],
        }),
        formatResult('branch-check', DECISION.ALLOW, 'ok'),
      ];
      const logged = formatChecksForLog(results);
      expect(logged[0].details).toContain('error TS1005');
      expect(logged[1].details).toBeUndefined();
    });

    it('formatCheckSummaryLine 应在 deny 时附加 details', () => {
      const line = formatCheckSummaryLine(
        formatResult('related-tests', DECISION.DENY, '关联测试失败', {
          output: 'AssertionError: expected true to be false',
        }),
      );
      expect(line).toContain('AssertionError');
      expect(line).toContain('❌');
    });

    it('summarizeCheckDetails 应合并 output 与 failures', () => {
      const text = summarizeCheckDetails({
        output: 'dep audit output',
        failures: [{ tool: 'tsc', stderr: 'syntax error' }],
      });
      expect(text).toContain('dep audit output');
      expect(text).toContain('syntax error');
    });
  });
});
