import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { join } from 'path';
import { Readable } from 'stream';
import { formatResult, decide, DECISION } from '../security-orchestrator.js';
import { extractMergeTarget } from '../checks/git-policy.js';
import { getCurrentBranch } from '../security-orchestrator.js';
import { summarizeResults } from '../quality-gate.js';
import { main as mergeMain } from '../merge-gate.js';
import { clearGateConfigCache } from '../gate-config.js';
import { createTempGitRepo, cleanupTempGitRepo, expectDeny } from './helpers.js';

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

describe('merge-gate main() PR-policy guard', () => {
  let originalStdin: typeof process.stdin;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalConsoleLog: typeof console.log;
  let output: string[];
  let repo: string;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    originalConsoleLog = console.log;
    output = [];
    console.log = ((...args: unknown[]) => {
      output.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    }) as typeof console.log;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
  });

  afterEach(() => {
    process.stdin = originalStdin;
    process.stdout.write = originalStdoutWrite;
    console.log = originalConsoleLog;
    if (repo) cleanupTempGitRepo(repo);
    repo = '';
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
  });

  it('main + remote + forcePrWhenRemote 开启时 deny PR 策略', async () => {
    repo = createTempGitRepo('main');
    execSync('git branch -M main', { cwd: repo });
    execSync('git remote add origin git@github.com:org/repo.git', { cwd: repo });
    clearGateConfigCache();
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'git merge feat/x' },
        session_id: 'mg-pr-policy',
        cwd: repo,
      }),
    ]);
    await mergeMain();
    const combined = output.join('');
    expect(expectDeny(combined)).toBe(true);
    expect(combined).toContain('forcePrWhenRemote');
  });

  it('main 无 remote 时跳过 PR 策略守卫进入既有逻辑', async () => {
    repo = createTempGitRepo('main');
    execSync('git branch -M main', { cwd: repo });
    clearGateConfigCache();
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'git merge' },
        session_id: 'mg-no-remote',
        cwd: repo,
      }),
    ]);
    await mergeMain();
    const combined = output.join('');
    expect(expectDeny(combined)).toBe(true);
    expect(combined).not.toContain('forcePrWhenRemote');
  });
});
