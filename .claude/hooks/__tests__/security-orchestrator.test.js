import { describe, it, expect } from 'bun:test';
import {
  formatResult,
  decide,
  formatHookOutput,
  checkToolAvailable,
  detectToolchain,
  execCommand,
  isGitIgnored,
  withTimeout,
  isGitRepo,
  getCurrentBranch,
  safeMain,
  readStdin,
} from '../security-orchestrator.js';

describe('security-orchestrator', () => {
  it('formatResult 应该返回正确格式', () => {
    const r = formatResult('test-check', 'deny', '测试拒绝');
    expect(r.checkId).toBe('test-check');
    expect(r.decision).toBe('deny');
    expect(r.message).toBe('测试拒绝');
    expect(r.timestamp).toBeDefined();
  });

  it('decide - 任一 deny 应该返回 deny', () => {
    const results = [
      formatResult('check1', 'allow', 'ok'),
      formatResult('check2', 'deny', 'not ok'),
      formatResult('check3', 'allow', 'ok'),
    ];
    const d = decide(results);
    expect(d.decision).toBe('deny');
    expect(d.denyResults.length).toBe(1);
  });

  it('decide - 有 warn 无 deny 应该返回 warn', () => {
    const results = [formatResult('check1', 'allow', 'ok'), formatResult('check2', 'warn', 'warning')];
    const d = decide(results);
    expect(d.decision).toBe('warn');
    expect(d.warnResults.length).toBe(1);
  });

  it('decide - 全部 allow 应该返回 allow', () => {
    const results = [
      formatResult('check1', 'allow', 'ok'),
      formatResult('check2', 'skip', 'skipped'),
      formatResult('check3', 'allow', 'also ok'),
    ];
    const d = decide(results);
    expect(d.decision).toBe('allow');
    expect(d.denyResults.length).toBe(0);
    expect(d.warnResults.length).toBe(0);
  });

  it('decide - deny 优先于 warn', () => {
    const results = [formatResult('check1', 'warn', 'warning'), formatResult('check2', 'deny', 'critical')];
    const d = decide(results);
    expect(d.decision).toBe('deny');
  });

  it('decide - 空数组应该返回 allow', () => {
    const d = decide([]);
    expect(d.decision).toBe('allow');
  });

  it('formatHookOutput - allow 应该返回 {}', () => {
    const output = formatHookOutput('allow', 'reason');
    expect(output).toBe('{}');
  });

  it('formatHookOutput - deny 应该返回 deny JSON', () => {
    const output = formatHookOutput('deny', '安全风险');
    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('安全风险');
  });

  it('checkToolAvailable - bun 应该可用', () => {
    const r = checkToolAvailable('bun');
    expect(r.available).toBe(true);
  });

  it('checkToolAvailable - 不存在的工具应该不可用', () => {
    const r = checkToolAvailable('non_existent_tool_xyz');
    expect(r.available).toBe(false);
  });

  it('execCommand 应该能执行简单命令', () => {
    const r = execCommand('echo "hello"');
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('hello');
  });

  it('execCommand 应该能处理命令失败', () => {
    const r = execCommand('exit 1');
    expect(r.success).toBe(false);
  });

  it('execCommand 应该能捕获 stderr', () => {
    // 使用一个会失败的命令来触发 stderr 捕获
    const r = execCommand('false');
    expect(r.success).toBe(false);
    // stderr 可能为空，但至少应该返回 success: false
  });

  it('readStdin 应该能读取 JSON 输入', async () => {
    const { Readable } = await import('stream');
    const testInput = JSON.stringify({ test: 'data' });

    // 模拟 stdin
    const originalStdin = process.stdin;
    const mockStdin = new Readable();
    mockStdin.push(testInput);
    mockStdin.push(null); // 结束流

    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    const result = await readStdin();
    expect(result).toEqual({ test: 'data' });

    // 恢复原始 stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true,
      configurable: true,
    });
  });

  it('readStdin 应该能处理 stdin 的 data 事件', async () => {
    const { EventEmitter } = await import('events');
    const mockStdin = new EventEmitter();
    mockStdin.setEncoding = () => {};

    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    const promise = readStdin();

    // 模拟 data 事件
    mockStdin.emit('data', '{"key":');
    mockStdin.emit('data', '"value"}');
    mockStdin.emit('end');

    const result = await promise;
    expect(result).toEqual({ key: 'value' });

    // 恢复原始 stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true,
      configurable: true,
    });
  });

  it('readStdin 应该能处理 stdin 的 error 事件', async () => {
    const { EventEmitter } = await import('events');
    const mockStdin = new EventEmitter();
    mockStdin.setEncoding = () => {};

    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    const promise = readStdin();

    // 模拟 error 事件
    mockStdin.emit('error', new Error('stdin error'));

    await expect(promise).rejects.toThrow('stdin error');

    // 恢复原始 stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true,
      configurable: true,
    });
  });

  it('readStdin 应该能处理无效 JSON', async () => {
    const { Readable } = await import('stream');

    // 模拟 stdin
    const originalStdin = process.stdin;
    const mockStdin = new Readable();
    mockStdin.push('invalid json');
    mockStdin.push(null);

    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    await expect(readStdin()).rejects.toThrow('JSON 解析失败');

    // 恢复原始 stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true,
      configurable: true,
    });
  });

  it('isGitIgnored - git 忽略的文件应该返回 true', () => {
    // 本项目 .gitignore 包含 GitHub/，测试这个场景
    const r = isGitIgnored('GitHub/some-file.js');
    expect(r).toBe(true);
  });

  it('isGitIgnored - 非 git 忽略的文件应该返回 false', () => {
    // CLAUDE.md 是项目文件，不在 .gitignore 中
    const r = isGitIgnored('CLAUDE.md');
    expect(r).toBe(false);
  });

  it('isGitIgnored - .claude 目录下的文件应该返回 false', () => {
    // .claude 目录是项目配置，不应该被忽略
    const r = isGitIgnored('.claude/settings.json');
    expect(r).toBe(false);
  });

  // ─── Story 6.3: isGitIgnored cwd 参数集成测试 ─────────────────────────────

  it('isGitIgnored - 指定 cwd 参数应正确检测 gitignored 文件', () => {
    const { mkdirSync, writeFileSync, rmSync } = require('fs');
    const { join } = require('path');
    const { execSync } = require('child_process');
    const tmpDir = join(require('os').tmpdir(), `gitignore-orch-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    writeFileSync(join(tmpDir, '.gitignore'), '*.log\ndist/\n');
    writeFileSync(join(tmpDir, 'README.md'), '# test');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir });
    try {
      writeFileSync(join(tmpDir, 'app.log'), 'log');
      mkdirSync(join(tmpDir, 'dist'), { recursive: true });
      writeFileSync(join(tmpDir, 'dist', 'out.js'), 'code');
      expect(isGitIgnored('app.log', tmpDir)).toBe(true);
      expect(isGitIgnored('dist/out.js', tmpDir)).toBe(true);
      expect(isGitIgnored('src/main.js', tmpDir)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('isGitIgnored - 无 cwd 参数时使用 process.cwd()', () => {
    // 本项目 .gitignore 包含 GitHub/
    const r = isGitIgnored('GitHub/some-file.js');
    expect(r).toBe(true);
  });

  describe('withTimeout - 超时控制', () => {
    it('应该在超时前完成的 Promise 返回结果', async () => {
      const fastPromise = new Promise((resolve) => setTimeout(() => resolve('done'), 10));
      const result = await withTimeout(fastPromise, 1000, '超时');
      expect(result).toBe('done');
    });

    it('应该在超时后抛出错误', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve('done'), 5000));
      try {
        await withTimeout(slowPromise, 10, '操作超时');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toBe('操作超时');
      }
    });

    it('应该处理立即拒绝的 Promise', async () => {
      const rejectPromise = Promise.reject(new Error('失败'));
      try {
        await withTimeout(rejectPromise, 1000, '超时');
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toBe('失败');
      }
    });
  });

  describe('isGitRepo - Git 仓库检测', () => {
    it('应该检测到当前目录是 git 仓库', () => {
      const result = isGitRepo(process.cwd());
      expect(result).toBe(true);
    });

    it('应该检测不到非 git 目录', () => {
      const result = isGitRepo('/tmp');
      expect(result).toBe(false);
    });

    it('应该处理不存在的路径', () => {
      const result = isGitRepo('/nonexistent/path/12345');
      expect(result).toBe(false);
    });
  });

  describe('getCurrentBranch - 获取当前分支', () => {
    it('应该返回当前分支名', () => {
      const branch = getCurrentBranch(process.cwd());
      expect(branch).toBeTruthy();
      expect(typeof branch).toBe('string');
    });

    it('应该在非 git 目录返回 null', () => {
      const branch = getCurrentBranch('/tmp');
      expect(branch).toBeNull();
    });
  });

  describe('safeMain - 安全主函数', () => {
    it('应该正常执行成功的函数', async () => {
      let executed = false;
      await safeMain(async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it('应该捕获并处理错误', async () => {
      const originalExit = process.exit;
      let exitCode;
      process.exit = (code) => {
        exitCode = code;
      };

      await safeMain(async () => {
        throw new Error('测试错误');
      });

      process.exit = originalExit;
      // safeMain 使用 exit(0) 实现优雅降级（不阻断 Claude）
      expect(exitCode).toBe(0);
    });

    it('应该捕获同步错误', async () => {
      const originalExit = process.exit;
      let exitCode;
      process.exit = (code) => {
        exitCode = code;
      };

      await safeMain(() => {
        throw new Error('同步错误');
      });

      process.exit = originalExit;
      // safeMain 使用 exit(0) 实现优雅降级（不阻断 Claude）
      expect(exitCode).toBe(0);
    });
  });

  describe('detectToolchain - 工具链检测', () => {
    it('当前项目应检测到 bun (package.json + bun.lock)', () => {
      const toolchain = detectToolchain(process.cwd());
      expect(toolchain.js).toBe('bun');
    });

    it('当前项目应检测到 uv (pyproject.toml)', () => {
      const toolchain = detectToolchain(process.cwd());
      expect(toolchain.python).toBe('uv');
    });

    it('不存在的目录应返回 null', () => {
      const toolchain = detectToolchain('/nonexistent/path/xyz');
      expect(toolchain.js).toBeNull();
      expect(toolchain.python).toBeNull();
    });

    it('无 cwd 参数时使用 process.cwd()', () => {
      const toolchain = detectToolchain();
      expect(toolchain).toBeDefined();
      expect(toolchain.js).toBeDefined();
      expect(toolchain.python).toBeDefined();
    });

    it('仅有 package.json 无 bun.lock 时 js 应为 node', () => {
      const { mkdirSync, writeFileSync, rmSync } = require('fs');
      const { join } = require('path');
      const tmpDir = join(require('os').tmpdir(), `toolchain-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(join(tmpDir, 'package.json'), '{}');
      try {
        const toolchain = detectToolchain(tmpDir);
        expect(toolchain.js).toBe('node');
        expect(toolchain.python).toBeNull();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('空目录应返回全 null', () => {
      const { mkdirSync, rmSync } = require('fs');
      const { join } = require('path');
      const tmpDir = join(require('os').tmpdir(), `toolchain-empty-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      try {
        const toolchain = detectToolchain(tmpDir);
        expect(toolchain.js).toBeNull();
        expect(toolchain.python).toBeNull();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
