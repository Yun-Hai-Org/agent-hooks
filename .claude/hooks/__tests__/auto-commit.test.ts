import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  isAutoCommitEnabled,
  getAutoCommitMode,
  buildCommitMessage,
  buildFixFollowupMessage,
  buildCommitFailureMessage,
  buildAgentCommitMessage,
  getMaxAutoCommitLoops,
  hasStagedChanges,
  runAutoCommit,
  parseStopInput,
  main,
} from '../auto-commit.js';
import { hasUncommittedChanges } from '../checks/git-policy.js';
import { formatStopContinueOutput } from '../hook-adapter.js';

import { disableGlobalGitHooks, PROJECT_ROOT } from './helpers.js';
import { Readable } from 'stream';

describe('auto-commit', () => {
  let tempDir;
  let repoPath;

  beforeEach(() => {
    delete process.env.AUTO_COMMIT;
    delete process.env.AUTO_COMMIT_MESSAGE;
    delete process.env.AUTO_COMMIT_MODE;
    tempDir = join('/tmp', `auto-commit-test-${Date.now()}`);
    repoPath = join(tempDir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    execSync('git init -b feat/test', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
    disableGlobalGitHooks(repoPath);
    writeFileSync(join(repoPath, 'README.md'), '# test\n');
    execSync('git add README.md', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "chore: init"', { cwd: repoPath, stdio: 'pipe' });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isAutoCommitEnabled', () => {
    it('默认启用', () => {
      expect(isAutoCommitEnabled()).toBe(true);
    });

    it('AUTO_COMMIT=0 时禁用', () => {
      process.env.AUTO_COMMIT = '0';
      expect(isAutoCommitEnabled()).toBe(false);
    });
  });

  describe('getAutoCommitMode', () => {
    it('默认 agent 模式', () => {
      expect(getAutoCommitMode()).toBe('agent');
    });

    it('AUTO_COMMIT_MODE=auto 时为 auto', () => {
      process.env.AUTO_COMMIT_MODE = 'auto';
      expect(getAutoCommitMode()).toBe('auto');
    });
  });

  describe('buildCommitMessage', () => {
    it('测试文件应用 test 类型', () => {
      expect(buildCommitMessage(['foo.test.js'])).toMatch(/^test: auto-commit/);
    });

    it('文档文件应用 docs 类型', () => {
      expect(buildCommitMessage(['README.md', 'docs/a.md'])).toMatch(/^docs: auto-commit/);
    });

    it('默认 feat 类型', () => {
      expect(buildCommitMessage(['src/app.js'])).toMatch(/^feat: auto-commit/);
    });

    it('尊重 AUTO_COMMIT_MESSAGE', () => {
      process.env.AUTO_COMMIT_MESSAGE = 'feat: custom message';
      expect(buildCommitMessage(['a.js'])).toBe('feat: custom message');
    });
  });

  describe('hasStagedChanges', () => {
    it('无暂存时应为 false', () => {
      expect(hasStagedChanges(repoPath)).toBe(false);
    });

    it('有暂存时应为 true', () => {
      writeFileSync(join(repoPath, 'x.js'), 'x');
      execSync('git add x.js', { cwd: repoPath, stdio: 'pipe' });
      expect(hasStagedChanges(repoPath)).toBe(true);
    });
  });

  describe('hasUncommittedChanges', () => {
    it('干净工作区应为 false', () => {
      expect(hasUncommittedChanges(repoPath)).toBe(false);
    });

    it('未暂存修改应为 true', () => {
      writeFileSync(join(repoPath, 'dirty.js'), 'dirty');
      expect(hasUncommittedChanges(repoPath)).toBe(true);
    });

    it('已暂存未提交应为 true', () => {
      writeFileSync(join(repoPath, 'staged.js'), 'staged');
      execSync('git add staged.js', { cwd: repoPath, stdio: 'pipe' });
      expect(hasUncommittedChanges(repoPath)).toBe(true);
    });
  });

  describe('buildAgentCommitMessage', () => {
    it('main 分支应提示切换 feature 分支', () => {
      execSync('git checkout -b main', { cwd: repoPath, stdio: 'pipe' });
      writeFileSync(join(repoPath, 'y.js'), 'y');
      execSync('git add y.js', { cwd: repoPath, stdio: 'pipe' });
      const msg = buildAgentCommitMessage(repoPath);
      expect(msg).toContain('[auto-commit]');
      expect(msg).toContain('main/master');
      expect(msg).toContain('feature 分支');
      expect(msg).toContain('git commit');
    });

    it('应要求 Agent 自行 commit', () => {
      writeFileSync(join(repoPath, 'z.js'), 'z');
      const msg = buildAgentCommitMessage(repoPath);
      expect(msg).toContain('[auto-commit]');
      expect(msg).toContain('git commit');
      expect(msg).not.toContain('自动提交');
    });
  });

  describe('buildFixFollowupMessage', () => {
    it('应包含失败检查摘要与修复指引', () => {
      const msg = buildFixFollowupMessage({
        results: [
          { checkId: 'typecheck', decision: 'deny', message: '类型错误' },
          { checkId: 'branch-check', decision: 'allow', message: 'ok' },
        ],
      });
      expect(msg).toContain('[auto-commit]');
      expect(msg).toContain('typecheck');
      expect(msg).toContain('修复步骤');
    });
  });

  describe('formatStopContinueOutput', () => {
    it('Claude 应返回 decision block', () => {
      const prev = process.env.HOOK_PLATFORM;
      process.env.HOOK_PLATFORM = 'claude';
      const out = JSON.parse(formatStopContinueOutput('fix me'));
      expect(out.decision).toBe('block');
      expect(out.reason).toBe('fix me');
      if (prev) process.env.HOOK_PLATFORM = prev;
      else delete process.env.HOOK_PLATFORM;
    });

    it('Cursor 应返回 followup_message', () => {
      const prev = process.env.HOOK_PLATFORM;
      process.env.HOOK_PLATFORM = 'cursor';
      const out = JSON.parse(formatStopContinueOutput('fix me'));
      expect(out.followup_message).toBe('fix me');
      if (prev) process.env.HOOK_PLATFORM = prev;
      else delete process.env.HOOK_PLATFORM;
    });
  });

  describe('getMaxAutoCommitLoops', () => {
    it('默认 8', () => {
      delete process.env.AUTO_COMMIT_MAX_LOOPS;
      expect(getMaxAutoCommitLoops()).toBe(8);
    });
  });

  describe('buildCommitFailureMessage', () => {
    it('应包含 stderr', () => {
      expect(buildCommitFailureMessage('hook failed')).toContain('hook failed');
    });
  });

  describe('runAutoCommit', () => {
    it('无暂存时不提交', async () => {
      const result = await runAutoCommit(repoPath);
      expect(result.committed).toBe(false);
      expect(result.reason).toBe('no staged changes');
    });

    it('main 分支不提交', async () => {
      execSync('git checkout -b main', { cwd: repoPath, stdio: 'pipe' });
      writeFileSync(join(repoPath, 'y.js'), 'y');
      execSync('git add y.js', { cwd: repoPath, stdio: 'pipe' });
      const result = await runAutoCommit(repoPath);
      expect(result.committed).toBe(false);
      expect(result.reason).toContain('blocked on main');
    });

    it('非 git 目录不提交', () => {
      const result = runAutoCommit('/tmp/not-a-git-repo-xyz');
      expect(result.committed).toBe(false);
      expect(result.reason).toBe('not a git repo');
    });

    it('AUTO_COMMIT=0 时不提交', () => {
      process.env.AUTO_COMMIT = '0';
      const result = runAutoCommit(repoPath);
      expect(result.committed).toBe(false);
      expect(result.reason).toBe('AUTO_COMMIT disabled');
    });
  });

  describe('parseStopInput', () => {
    it('应解析 cwd 与 session_id', () => {
      const parsed = parseStopInput({ cwd: '/repo', session_id: 's1', loop_count: 2, status: 'completed' });
      expect(parsed.cwd).toBe('/repo');
      expect(parsed.sessionId).toBe('s1');
      expect(parsed.loopCount).toBe(2);
    });

    it('workspace_roots 回退 cwd', () => {
      const parsed = parseStopInput({ workspace_roots: [repoPath] });
      expect(parsed.cwd).toBe(repoPath);
    });

    it('仅 conversation_id 时回退到 conversation_id', () => {
      const parsed = parseStopInput({ cwd: '/repo', conversation_id: 'c1' });
      expect(parsed.sessionId).toBe('c1');
    });
  });

  describe('buildCommitMessage chore 分支', () => {
    it('lock 文件应用 chore 类型', () => {
      expect(buildCommitMessage(['bun.lock', 'package.json'])).toMatch(/^chore: auto-commit/);
    });
  });

  describe('auto-commit main', () => {
    const origStdin = process.stdin;
    const origLog = console.log;

    afterEach(() => {
      Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
      console.log = origLog;
      delete process.env.AUTO_COMMIT;
      delete process.env.HOOK_PLATFORM;
    });

    it('AUTO_COMMIT=0 时输出 {}', async () => {
      process.env.AUTO_COMMIT = '0';
      const logs: string[] = [];
      console.log = (msg) => logs.push(String(msg));
      Object.defineProperty(process, 'stdin', {
        value: Readable.from([JSON.stringify({ cwd: PROJECT_ROOT, session_id: 's1', status: 'completed' })]),
        configurable: true,
      });
      await main();
      expect(logs).toContain('{}');
    });

    it('agent 模式干净工作区输出 {}', async () => {
      const logs: string[] = [];
      console.log = (msg) => logs.push(String(msg));
      Object.defineProperty(process, 'stdin', {
        value: Readable.from([
          JSON.stringify({ cwd: PROJECT_ROOT, session_id: 's2', status: 'completed', hook_event_name: 'Stop' }),
        ]),
        configurable: true,
      });
      await main();
      expect(logs.some((l) => l === '{}' || l.includes('decision'))).toBe(true);
    });
  });
});
