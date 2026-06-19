import { describe, it, expect } from 'bun:test';
import { parseArgs, runQualityGate } from '../quality-gate.js';
import { DECISION } from '../security-orchestrator.js';
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
});
