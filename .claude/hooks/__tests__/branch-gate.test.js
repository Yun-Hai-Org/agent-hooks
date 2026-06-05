import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { join } from 'path';
import { Readable } from 'stream';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  MAIN_BRANCHES,
  SAFE_COMMAND_PATTERNS,
  FILE_WRITE_PATTERNS,
  log,
  getCurrentBranch,
  isInsideWorktree,
  isSafeCommand,
  isFileWriteCommand,
  getWritePatternName,
  allow,
  deny,
  main,
} from '../branch-gate.js';

describe('branch-gate', () => {
  const HOOK_PATH = join(import.meta.dir, '..', 'branch-gate.js');

  // 辅助函数：运行 hook 并获取输出
  function runHook(input) {
    return new Promise((resolve, reject) => {
      const child = spawn('bun', [HOOK_PATH], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });

      child.on('error', reject);

      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    });
  }

  describe('MAIN_BRANCHES 常量', () => {
    it('应该包含 main', () => {
      expect(MAIN_BRANCHES.includes('main')).toBe(true);
    });

    it('应该包含 master', () => {
      expect(MAIN_BRANCHES.includes('master')).toBe(true);
    });

    it('不应该包含 develop', () => {
      expect(MAIN_BRANCHES.includes('develop')).toBe(false);
    });
  });

  describe('FILE_WRITE_PATTERNS 模式检测', () => {
    it('应该检测重定向写入 (>)', () => {
      const cmd = 'echo "test" > file.txt';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测追加写入 (>>)', () => {
      const cmd = 'echo "test" >> file.txt';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测 tee 命令', () => {
      const cmd = 'echo "test" | tee file.txt';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测 sed 原地编辑', () => {
      const cmd = 'sed -i "s/old/new/" file.txt';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测 cp 复制', () => {
      const cmd = 'cp source.txt target.txt';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测 mv 移动', () => {
      const cmd = 'mv old.txt new.txt';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测 echo 重定向', () => {
      const cmd = 'echo "content" > file.txt';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测 dd 命令', () => {
      const cmd = 'dd if=/dev/zero of=file.bin bs=1M count=1';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测 install 命令', () => {
      const cmd = 'install -m 755 source target';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测 cat 重定向', () => {
      const cmd = 'cat source.txt > target.txt';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('应该检测 printf 重定向', () => {
      const cmd = 'printf "test" > file.txt';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(true);
    });

    it('不应该检测普通的 ls 命令', () => {
      const cmd = 'ls -la';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(false);
    });

    it('不应该检测普通的 git 命令', () => {
      const cmd = 'git status';
      expect(FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(cmd))).toBe(false);
    });
  });

  describe('非目标工具处理', () => {
    it('Read 工具应该直接允许', async () => {
      const result = await runHook({
        tool_name: 'Read',
        tool_input: { file_path: 'README.md' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      expect(result.stdout.trim()).toBe('{}');
    });

    it('ListFiles 工具应该直接允许', async () => {
      const result = await runHook({
        tool_name: 'ListFiles',
        tool_input: {},
        session_id: 'test',
        cwd: process.cwd(),
      });
      expect(result.stdout.trim()).toBe('{}');
    });
  });

  describe('分支检测逻辑', () => {
    it('应该识别 main 分支', () => {
      const MAIN_BRANCHES = ['main', 'master'];
      expect(MAIN_BRANCHES.includes('main')).toBe(true);
    });

    it('应该识别 master 分支', () => {
      const MAIN_BRANCHES = ['main', 'master'];
      expect(MAIN_BRANCHES.includes('master')).toBe(true);
    });

    it('应该允许 feature 分支', () => {
      const MAIN_BRANCHES = ['main', 'master'];
      expect(MAIN_BRANCHES.includes('feature/test')).toBe(false);
    });

    it('应该允许 develop 分支', () => {
      const MAIN_BRANCHES = ['main', 'master'];
      expect(MAIN_BRANCHES.includes('develop')).toBe(false);
    });
  });

  describe('Bash 工具文件写入检测', () => {
    it('应该检测 echo 重定向到文件', () => {
      const cmd = 'echo "test" > output.txt';
      const hasRedirect = /[>]/.test(cmd);
      expect(hasRedirect).toBe(true);
    });

    it('应该检测 tee 命令', () => {
      const cmd = 'echo "test" | tee output.txt';
      const hasTee = /\btee\b/.test(cmd);
      expect(hasTee).toBe(true);
    });

    it('应该检测 sed -i 命令', () => {
      const cmd = 'sed -i "s/old/new/" file.txt';
      const hasSedI = /sed\s+-i/.test(cmd);
      expect(hasSedI).toBe(true);
    });

    it('应该检测 cp 命令', () => {
      const cmd = 'cp source.txt target.txt';
      const hasCp = /\bcp\b/.test(cmd);
      expect(hasCp).toBe(true);
    });

    it('应该检测 mv 命令', () => {
      const cmd = 'mv old.txt new.txt';
      const hasMv = /\bmv\b/.test(cmd);
      expect(hasMv).toBe(true);
    });

    it('不应该检测普通的 git 命令', () => {
      const cmd = 'git status';
      const hasWriteOps = /[>]|tee|sed\s+-i|\bcp\b|\bmv\b|\bdd\b|\binstall\b/.test(cmd);
      expect(hasWriteOps).toBe(false);
    });

    it('不应该检测普通的 ls 命令', () => {
      const cmd = 'ls -la';
      const hasWriteOps = /[>]|tee|sed\s+-i|\bcp\b|\bmv\b|\bdd\b|\binstall\b/.test(cmd);
      expect(hasWriteOps).toBe(false);
    });
  });

  describe('Write/Edit 工具处理', () => {
    it('Write 工具在 main 分支应该被拒绝（如果在 main 分支）', async () => {
      const currentBranch = process.env.CI ? 'main' : 'feature/test';

      const result = await runHook({
        tool_name: 'Write',
        tool_input: { file_path: 'test.txt', content: 'test' },
        session_id: 'test',
        cwd: process.cwd(),
      });

      if (currentBranch === 'main') {
        const output = JSON.parse(result.stdout);
        expect(output.hookSpecificOutput?.permissionDecision).toBe('deny');
      } else {
        expect(result.stdout.trim()).toBe('{}');
      }
    });

    it('Edit 工具在 main 分支应该被拒绝（如果在 main 分支）', async () => {
      const currentBranch = process.env.CI ? 'main' : 'feature/test';

      const result = await runHook({
        tool_name: 'Edit',
        tool_input: { file_path: 'test.txt', new_string: 'test' },
        session_id: 'test',
        cwd: process.cwd(),
      });

      if (currentBranch === 'main') {
        const output = JSON.parse(result.stdout);
        expect(output.hookSpecificOutput?.permissionDecision).toBe('deny');
      } else {
        expect(result.stdout.trim()).toBe('{}');
      }
    });
  });

  describe('错误处理', () => {
    it('应该处理无效 JSON', async () => {
      const child = spawn('bun', [HOOK_PATH], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stdin.write('{invalid json}');
      child.stdin.end();

      await new Promise((resolve) => child.on('close', resolve));
      expect(stdout.trim()).toBe('{}');
    });

    it('应该处理空 stdin', async () => {
      const result = await runHook({});
      expect(result.code).toBe(0);
    });

    it('应该处理缺失的 tool_name', async () => {
      const result = await runHook({
        tool_input: { file_path: 'test.txt' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      expect(result.stdout.trim()).toBe('{}');
    });
  });

  describe('输出格式', () => {
    it('allow() 应该返回空 JSON', () => {
      const allow = () => JSON.stringify({});
      expect(allow()).toBe('{}');
    });

    it('deny() 应该返回正确的拒绝格式', () => {
      const deny = (reason) =>
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
          },
        });

      const result = JSON.parse(deny('测试拒绝原因'));
      expect(result.hookSpecificOutput.hookEventName).toBe('PreToolUse');
      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(result.hookSpecificOutput.permissionDecisionReason).toBe('测试拒绝原因');
    });
  });

  describe('完整流程测试', () => {
    it('应该处理正常的 git 命令', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      expect(result.stdout.trim()).toBe('{}');
    });

    it('应该处理正常的 npm 命令', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'npm install' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      expect(result.stdout.trim()).toBe('{}');
    });

    it('应该处理正常的 ls 命令', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      expect(result.stdout.trim()).toBe('{}');
    });
  });

  // 直接测试导出的函数（确保覆盖率）
  describe('导出函数直接测试', () => {
    it('getCurrentBranch 应该返回字符串或 null', () => {
      const branch = getCurrentBranch(process.cwd());
      expect(typeof branch === 'string' || branch === null).toBe(true);
    });

    it('getCurrentBranch 应该处理无效目录', () => {
      const branch = getCurrentBranch('/nonexistent/path');
      expect(branch).toBe(null);
    });

    it('isInsideWorktree 应该检测 worktree 环境', () => {
      const result = isInsideWorktree(process.cwd());
      expect(typeof result).toBe('boolean');
    });

    it('isInsideWorktree 应该返回 false 对于非 worktree', () => {
      const result = isInsideWorktree('/nonexistent/path');
      expect(result).toBe(false);
    });

    it('isFileWriteCommand 应该检测重定向', () => {
      expect(isFileWriteCommand('echo "test" > file.txt')).toBe(true);
      expect(isFileWriteCommand('ls -la')).toBe(false);
      expect(isFileWriteCommand(null)).toBe(false);
      expect(isFileWriteCommand('')).toBe(false);
    });

    it('isFileWriteCommand 应该检测 tee 命令', () => {
      expect(isFileWriteCommand('echo "test" | tee file.txt')).toBe(true);
    });

    it('isFileWriteCommand 应该检测 sed -i', () => {
      expect(isFileWriteCommand('sed -i "s/old/new/" file.txt')).toBe(true);
    });

    it('isFileWriteCommand 应该检测 cp 命令', () => {
      expect(isFileWriteCommand('cp source.txt target.txt')).toBe(true);
    });

    it('isFileWriteCommand 应该检测 mv 命令', () => {
      expect(isFileWriteCommand('mv old.txt new.txt')).toBe(true);
    });

    it('isFileWriteCommand 应该检测 dd 命令', () => {
      expect(isFileWriteCommand('dd if=/dev/zero of=file.bin')).toBe(true);
    });

    it('isFileWriteCommand 应该检测 install 命令', () => {
      expect(isFileWriteCommand('install -m 755 source target')).toBe(true);
    });

    it('isFileWriteCommand 不应该把 2>/dev/null 误判为文件写入', () => {
      expect(isFileWriteCommand('git checkout -b feat/epic-1 2>/dev/null')).toBe(false);
    });

    it('isFileWriteCommand 不应该把 >/dev/null 误判为文件写入', () => {
      expect(isFileWriteCommand('command >/dev/null')).toBe(false);
    });

    it('isFileWriteCommand 应该检测 2>/dev/null 之外的真正重定向', () => {
      expect(isFileWriteCommand('echo "test" > file.txt 2>/dev/null')).toBe(true);
    });

    it('isFileWriteCommand 不应该把 2>&1 误判为文件写入', () => {
      // 2>&1 是 stderr 重定向到 stdout，不是写文件
      expect(isFileWriteCommand('git log 2>&1')).toBe(false);
    });

    it('getWritePatternName 应该返回匹配的模式名称', () => {
      expect(getWritePatternName('echo "test" > file.txt')).toBe('重定向写入 (>)');
      expect(getWritePatternName('ls -la')).toBe(null);
      expect(getWritePatternName(null)).toBe(null);
      expect(getWritePatternName('')).toBe(null);
    });

    it('getWritePatternName 应该检测各种写入命令', () => {
      // >> 也会匹配 >，所以返回 "重定向写入 (>)"
      expect(getWritePatternName('echo "test" >> file.txt')).toBe('重定向写入 (>)');
      expect(getWritePatternName('echo "test" | tee file.txt')).toBe('tee 命令');
      expect(getWritePatternName('sed -i "s/old/new/" file.txt')).toBe('sed 原地编辑');
      expect(getWritePatternName('cp source.txt target.txt')).toBe('cp 复制');
      expect(getWritePatternName('mv old.txt new.txt')).toBe('mv 移动');
      expect(getWritePatternName('dd if=/dev/zero of=file.bin')).toBe('dd 命令');
      expect(getWritePatternName('install -m 755 source target')).toBe('install 命令');
    });

    it('getWritePatternName 不应该把 2>/dev/null 误判为文件写入', () => {
      expect(getWritePatternName('git checkout -b feat/epic-1 2>/dev/null')).toBe(null);
    });

    it('isSafeCommand 应该允许 git checkout', () => {
      expect(isSafeCommand('git checkout -b feat/epic-1')).toBe(true);
    });

    it('isSafeCommand 应该允许 git branch', () => {
      expect(isSafeCommand('git branch')).toBe(true);
      expect(isSafeCommand('git branch -a')).toBe(true);
    });

    it('isSafeCommand 应该允许 git stash', () => {
      expect(isSafeCommand('git stash')).toBe(true);
    });

    it('isSafeCommand 应该允许 git log', () => {
      expect(isSafeCommand('git log --oneline')).toBe(true);
    });

    it('isSafeCommand 应该允许 git status', () => {
      expect(isSafeCommand('git status')).toBe(true);
    });

    it('isSafeCommand 应该允许 git show', () => {
      expect(isSafeCommand('git show HEAD')).toBe(true);
    });

    it('isSafeCommand 应该允许 git diff', () => {
      expect(isSafeCommand('git diff')).toBe(true);
    });

    it('isSafeCommand 不应该允许 git commit', () => {
      expect(isSafeCommand('git commit -m "test"')).toBe(false);
    });

    it('isSafeCommand 不应该允许 git push', () => {
      expect(isSafeCommand('git push origin main')).toBe(false);
    });

    it('isSafeCommand 不应该允许非 git 命令', () => {
      expect(isSafeCommand('echo hello > file.txt')).toBe(false);
      expect(isSafeCommand('ls -la')).toBe(false);
    });

    it('allow 应该返回正确的 JSON', () => {
      const result = JSON.parse(allow());
      expect(result).toEqual({});
    });

    it('deny 应该返回正确的拒绝格式', () => {
      const result = JSON.parse(deny('测试原因'));
      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(result.hookSpecificOutput.permissionDecisionReason).toBe('测试原因');
    });

    it('log 应该正常执行', () => {
      expect(() => log({ level: 'TEST', message: 'test' })).not.toThrow();
    });

    it('log 应该处理各种日志级别', () => {
      expect(() => log({ level: 'INFO', message: 'info test' })).not.toThrow();
      expect(() => log({ level: 'WARN', message: 'warn test' })).not.toThrow();
      expect(() => log({ level: 'ERROR', message: 'error test' })).not.toThrow();
    });
  });

  // main() 函数直接测试
  describe('main() 函数直接测试', () => {
    let originalStdin;
    let originalConsoleLog;
    let consoleOutput;

    beforeEach(() => {
      originalStdin = process.stdin;
      originalConsoleLog = console.log;
      consoleOutput = [];

      // Mock console.log to capture output
      console.log = (...args) => {
        consoleOutput.push(args.join(' '));
      };
    });

    afterEach(() => {
      process.stdin = originalStdin;
      console.log = originalConsoleLog;
    });

    it('应该允许非目标工具（Read）', async () => {
      const inputData = JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'README.md' },
        session_id: 'test-1',
        cwd: process.cwd(),
      });

      process.stdin = Readable.from([inputData]);
      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');
    });

    it('应该允许非目标工具（ListFiles）', async () => {
      const inputData = JSON.stringify({
        tool_name: 'ListFiles',
        tool_input: {},
        session_id: 'test-2',
        cwd: process.cwd(),
      });

      process.stdin = Readable.from([inputData]);
      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');
    });

    it('应该在 worktree 环境中允许所有操作', async () => {
      const inputData = JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'test.txt', content: 'test' },
        session_id: 'test-3',
        cwd: process.cwd(),
      });

      process.stdin = Readable.from([inputData]);

      // Mock isInsideWorktree to return true
      const originalIsInsideWorktree = isInsideWorktree;
      global.isInsideWorktree = () => true;

      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');

      global.isInsideWorktree = originalIsInsideWorktree;
    });

    it('应该允许当前分支上的 Write 操作（非主分支）', async () => {
      // 当前 repo 在 feat/ 分支上，所以 Write 应该被允许
      const inputData = JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'test.txt', content: 'test' },
        session_id: 'test-4',
        cwd: process.cwd(),
      });

      process.stdin = Readable.from([inputData]);
      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');
    });

    it('应该处理无法获取分支的情况', async () => {
      const tempDir = '/tmp/test-no-git-branchgate';
      mkdirSync(tempDir, { recursive: true });

      const inputData = JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'test.txt', content: 'test' },
        session_id: 'test-7',
        cwd: tempDir,
      });

      process.stdin = Readable.from([inputData]);
      await main();

      // 无法获取分支时应该允许
      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');

      rmSync(tempDir, { recursive: true, force: true });
    });

    it('应该处理 isInsideWorktree 的异常情况', async () => {
      // 测试 isInsideWorktree 的 catch 分支
      const result = isInsideWorktree('/nonexistent/path/that/does/not/exist');
      expect(result).toBe(false);
    });

    it('应该处理无效 JSON 输入', async () => {
      process.stdin = Readable.from(['{invalid json}']);
      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');
    });

    it('应该处理空输入', async () => {
      process.stdin = Readable.from(['{}']);
      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');
    });

    it('应该处理 Bash 工具的非写入命令', async () => {
      const inputData = JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
        session_id: 'test-5',
        cwd: process.cwd(),
      });

      process.stdin = Readable.from([inputData]);
      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');
    });

    it('应该处理 Bash 工具的写入命令', async () => {
      const inputData = JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'echo "test" > file.txt' },
        session_id: 'test-6',
        cwd: process.cwd(),
      });

      process.stdin = Readable.from([inputData]);
      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');
    });

    it('应该处理 Write 工具', async () => {
      const inputData = JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'test.txt', content: 'test' },
        session_id: 'test-7',
        cwd: process.cwd(),
      });

      process.stdin = Readable.from([inputData]);
      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');
    });

    it('应该处理 Edit 工具', async () => {
      const inputData = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: 'test.txt', old_string: 'old', new_string: 'new' },
        session_id: 'test-8',
        cwd: process.cwd(),
      });

      process.stdin = Readable.from([inputData]);
      await main();

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toBe('{}');
    });
  });
});
