import { describe, it, expect } from 'bun:test';
import {
  formatResult,
  decide,
  formatHookOutput,
  checkToolAvailable,
  execCommand,
  isGitIgnored,
  withTimeout,
  isGitRepo,
  getCurrentBranch,
  safeMain,
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
});
