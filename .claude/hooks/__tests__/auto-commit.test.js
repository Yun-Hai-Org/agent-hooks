import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  isAutoCommitEnabled,
  buildCommitMessage,
  buildFixFollowupMessage,
  buildCommitFailureMessage,
  getMaxAutoCommitLoops,
  hasStagedChanges,
  runAutoCommit,
} from '../auto-commit.js';
import { formatStopContinueOutput } from '../hook-adapter.js';

describe('auto-commit', () => {
  let tempDir;
  let repoPath;

  beforeEach(() => {
    delete process.env.AUTO_COMMIT;
    delete process.env.AUTO_COMMIT_MESSAGE;
    tempDir = join('/tmp', `auto-commit-test-${Date.now()}`);
    repoPath = join(tempDir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    execSync('git init -b feat/test', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
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
  });
});
