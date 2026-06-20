import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseArgs,
  runQualityGate,
  formatChecksForLog,
  summarizeCheckDetails,
  formatCheckSummaryLine,
} from '../quality-gate.js';
import { DECISION, formatResult } from '../security-orchestrator.js';
import { checkCommitMessage } from '../checks/git-policy.js';

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

    it('commit profile 应包含 extended-lint 与 schema-lint 检查项', async () => {
      const result = await runQualityGate({
        profile: 'commit',
        cwd: '/tmp',
        commitCmd: 'git commit -m "feat: test"',
      });
      const checkIds = result.results.map((r) => r.checkId);
      expect(checkIds).toContain('extended-staged');
      expect(checkIds).toContain('k8s-staged');
      expect(checkIds.some((id) => id.startsWith('schema-staged'))).toBe(true);
    });
  });

  describe('runQualityGate full smoke', () => {
    it('quality-gate 应接入 full profile 的 extended/schema 检查', () => {
      const source = readFileSync(join(import.meta.dir, '..', 'quality-gate.js'), 'utf-8');
      expect(source).toContain('runExtendedLintFull(cwd)');
      expect(source).toContain('runSchemaLintFull(cwd)');
      expect(source).toContain('runK8sLintFull(cwd)');
    });

    it('pyproject 不应忽略 ANN101/ANN102', () => {
      const pyproject = readFileSync(join(import.meta.dir, '..', '..', '..', 'pyproject.toml'), 'utf-8');
      expect(pyproject).not.toContain('ANN101');
      expect(pyproject).not.toContain('ANN102');
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
