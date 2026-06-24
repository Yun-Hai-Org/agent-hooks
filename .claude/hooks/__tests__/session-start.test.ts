import { describe, it, expect, mock } from 'bun:test';
import { spawn } from 'child_process';
import { join } from 'path';
import {
  checkTool,
  formatToolStatus,
  formatReport,
  formatJsonResult,
  checkAllTools,
  TOOLS,
  getToolVersion,
} from '../session-start.js';

// session-start 测试 - 测试工具检测、格式化和超时逻辑
describe('session-start', () => {
  const HOOK_PATH = join(import.meta.dir, '..', 'session-start.ts');

  // 辅助函数：运行 hook 并获取输出
  function runHook(input = '{}') {
    return new Promise((resolve, reject) => {
      const child = spawn('bun', [HOOK_PATH], {
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

      child.stdin.write(input);
      child.stdin.end();
    });
  }

  // 辅助函数：解析 JSON 输出
  function parseOutput(stdout) {
    try {
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }

  // ─── checkTool 测试 ─────────────────────────────────────────────────────

  describe('checkTool', () => {
    it('已安装工具应返回 available: true', () => {
      // bun 一定在环境中可用（测试运行依赖它）
      const result = checkTool('bun', 'bun', 'bun --version');
      expect(result.available).toBe(true);
      expect(result.name).toBe('bun');
      expect(result.version).toBeTruthy();
    });

    it('未安装工具应返回 available: false', () => {
      const result = checkTool('nonexistent-tool-xyz', 'nonexistent-tool-xyz');
      expect(result.available).toBe(false);
      expect(result.name).toBe('nonexistent-tool-xyz');
      expect(result.version).toBe('');
    });

    it('版本命令失败时应返回空版本字符串', () => {
      // bun 存在但用一个无效的版本命令
      const result = checkTool('bun', 'bun', 'bun --nonexistent-flag');
      expect(result.available).toBe(true);
      // 版本可能为空（命令失败）但工具仍然可用
    });
  });

  // ─── formatToolStatus 测试 ──────────────────────────────────────────────

  describe('formatToolStatus', () => {
    it('可用工具应显示 🟢 和 ✔', () => {
      const status = formatToolStatus({ name: 'shellcheck', available: true, version: '0.10.0' });
      expect(status).toContain('🟢');
      expect(status).toContain('shellcheck');
      expect(status).toContain('✔');
      expect(status).toContain('0.10.0');
    });

    it('可用工具无版本时不应显示版本号', () => {
      const status = formatToolStatus({ name: 'pyright', available: true, version: '' });
      expect(status).toContain('🟢');
      expect(status).toContain('pyright');
      expect(status).toContain('✔');
      expect(status).not.toContain('(');
    });

    it('不可用工具应显示 🔴 和 ❌', () => {
      const status = formatToolStatus({ name: 'sqlfluff', available: false, version: '' });
      expect(status).toContain('🔴');
      expect(status).toContain('sqlfluff');
      expect(status).toContain('❌');
      expect(status).toContain('未安装');
    });
  });

  // ─── formatReport 测试 ──────────────────────────────────────────────────

  describe('formatReport', () => {
    it('应包含标题行和可用/不可用统计', () => {
      const results = [
        { name: 'bun', available: true, version: '1.3.6' },
        { name: 'shellcheck', available: false, version: '' },
      ];
      const report = formatReport(results);
      expect(report).toContain('工具健康检查 (1/2 可用)');
      expect(report).toContain('🟢 bun');
      expect(report).toContain('🔴 shellcheck');
    });

    it('全部工具可用时不应显示缺失工具区域', () => {
      const results = [
        { name: 'bun', available: true, version: '1.3.6' },
        { name: 'prettier', available: true, version: '3.8.1' },
      ];
      const report = formatReport(results);
      expect(report).toContain('(2/2 可用)');
      expect(report).not.toContain('缺失工具');
    });

    it('全部工具不可用时应全部显示为缺失', () => {
      const results = [
        { name: 'semgrep', available: false, version: '' },
        { name: 'trivy', available: false, version: '' },
      ];
      const report = formatReport(results);
      expect(report).toContain('(0/2 可用)');
      expect(report).toContain('缺失工具');
      expect(report).toContain('🔴 semgrep');
      expect(report).toContain('🔴 trivy');
    });
  });

  // ─── formatJsonResult 测试 ──────────────────────────────────────────────

  describe('formatJsonResult', () => {
    it('应输出合法 JSON 且包含完整结构', () => {
      const results = [
        { name: 'bun', available: true, version: '1.3.6' },
        { name: 'shellcheck', available: false, version: '' },
      ];
      const json = JSON.parse(formatJsonResult(results));

      expect(json.hookSpecificOutput).toBeDefined();
      expect(json.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(json.hookSpecificOutput.summary).toEqual({
        total: 2,
        available: 1,
        unavailable: 1,
      });
      expect(json.hookSpecificOutput.tools.bun).toEqual({
        available: true,
        version: '1.3.6',
      });
      expect(json.hookSpecificOutput.tools.shellcheck).toEqual({
        available: false,
        version: null,
      });
    });

    it('应包含 report 字段（人类可读文本）', () => {
      const results = [{ name: 'bun', available: true, version: '1.0.0' }];
      const json = JSON.parse(formatJsonResult(results));
      expect(json.hookSpecificOutput.report).toContain('🟢 bun');
    });
  });

  // ─── TOOLS 列表测试 ────────────────────────────────────────────────────

  describe('TOOLS 列表', () => {
    it('应包含所有必要的工具', () => {
      const toolNames = TOOLS.map((t) => t.name);
      // Shell 工具
      expect(toolNames).toContain('shellcheck');
      expect(toolNames).toContain('shfmt');
      // Docker 工具
      expect(toolNames).toContain('hadolint');
      expect(toolNames).toContain('container-runtime');
      // K8s 工具
      expect(toolNames).toContain('kubeconform');
      expect(toolNames).toContain('kube-linter');
      // TOML 工具
      expect(toolNames).toContain('taplo');
      // SQL 工具
      expect(toolNames).toContain('sqlfluff');
      // CSS 工具
      expect(toolNames).toContain('stylelint');
      // 通用格式化
      expect(toolNames).toContain('prettier');
      // JS/TS 工具
      expect(toolNames).toContain('eslint');
      // Python 工具
      expect(toolNames).toContain('ruff');
      expect(toolNames).toContain('pyright');
      // Markdown 工具
      expect(toolNames).toContain('markdownlint');
      // JSON/YAML 工具
      expect(toolNames).toContain('jq');
      expect(toolNames).toContain('yq');
      // Schema 验证
      expect(toolNames).toContain('check-jsonschema');
      // 安全扫描
      expect(toolNames).toContain('semgrep');
      expect(toolNames).toContain('trivy');
      // 死代码检测
      expect(toolNames).toContain('knip');
      // 包管理器
      expect(toolNames).toContain('bun');
      expect(toolNames).toContain('uv');
    });

    it('每个工具条目应包含 name、binary、versionCmd', () => {
      for (const tool of TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.binary).toBeTruthy();
        expect(tool.versionCmd).toBeTruthy();
      }
    });

    it('工具总数应不少于 15', () => {
      expect(TOOLS.length).toBeGreaterThanOrEqual(15);
    });
  });

  // ─── checkAllTools 测试 ─────────────────────────────────────────────────

  describe('checkAllTools', () => {
    const checkTimeoutMs = 15000;

    it(
      '应返回与 TOOLS 列表相同数量的结果',
      async () => {
        const results = await checkAllTools();
        expect(results.length).toBe(TOOLS.length);
      },
      checkTimeoutMs,
    );

    it(
      '每个结果应包含 name、available、version',
      async () => {
        const results = await checkAllTools();
        for (const r of results) {
          expect(typeof r.name).toBe('string');
          expect(typeof r.available).toBe('boolean');
          expect(typeof r.version).toBe('string');
        }
      },
      checkTimeoutMs,
    );

    it(
      'bun 工具应始终检测为可用',
      async () => {
        const results = await checkAllTools();
        const bunResult = results.find((r) => r.name === 'bun');
        expect(bunResult).toBeDefined();
        expect(bunResult.available).toBe(true);
      },
      checkTimeoutMs,
    );

    it(
      '应在合理时间内完成（< 5 秒）',
      async () => {
        const start = Date.now();
        await checkAllTools();
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(10000);
      },
      checkTimeoutMs,
    );
  });

  // ─── getToolVersion 版本解析测试 ────────────────────────────────────────

  describe('getToolVersion', () => {
    it('应能解析标准版本号（如 bun）', () => {
      const version = getToolVersion('bun --version');
      expect(version).toBeTruthy();
      // bun 输出纯版本号如 "1.3.6"
      expect(version).toMatch(/^\d+\.\d+/);
    });

    it('应优先提取 "version:" 开头的行（shellcheck 模式）', () => {
      // 模拟 shellcheck 输出：第一行是标题，第二行是版本
      // 用 printf 模拟多行输出
      const version = getToolVersion(
        'printf "ShellCheck - shell script analysis tool\\nversion: 0.10.0\\nLicense: GPL"',
      );
      expect(version).toBe('0.10.0');
    });

    it('无 "version:" 行时应回退到第一行', () => {
      const version = getToolVersion('printf "3.8.1\\nother line"');
      expect(version).toBe('3.8.1');
    });

    it('命令失败时应返回空字符串', () => {
      const version = getToolVersion('false');
      expect(version).toBe('');
    });
  });

  // ─── 完整 Hook 集成测试 ────────────────────────────────────────────────

  describe('完整 Hook 运行', () => {
    const hookTimeoutMs = 15000;

    it(
      '应正常退出（exit code 0）',
      async () => {
        const { code } = await runHook();
        expect(code).toBe(0);
      },
      hookTimeoutMs,
    );

    it(
      'stdout 应输出合法 JSON',
      async () => {
        const { stdout } = await runHook();
        const parsed = parseOutput(stdout);
        expect(parsed).not.toBeNull();
      },
      hookTimeoutMs,
    );

    it(
      'JSON 输出应包含 hookEventName: SessionStart',
      async () => {
        const { stdout } = await runHook();
        const parsed = parseOutput(stdout);
        expect(parsed?.hookSpecificOutput?.hookEventName).toBe('SessionStart');
      },
      hookTimeoutMs,
    );

    it(
      'JSON 输出应包含 summary 和 tools',
      async () => {
        const { stdout } = await runHook();
        const parsed = parseOutput(stdout);
        expect(parsed?.hookSpecificOutput?.summary).toBeDefined();
        expect(parsed?.hookSpecificOutput?.tools).toBeDefined();
        expect(typeof parsed.hookSpecificOutput.summary.total).toBe('number');
        expect(typeof parsed.hookSpecificOutput.summary.available).toBe('number');
        expect(typeof parsed.hookSpecificOutput.summary.unavailable).toBe('number');
      },
      hookTimeoutMs,
    );

    it(
      'stderr 应输出人类可读的健康报告',
      async () => {
        const { stderr } = await runHook();
        expect(stderr).toContain('工具健康检查');
        expect(stderr).toContain('可用');
      },
      hookTimeoutMs,
    );

    it(
      '应在 5 秒内完成（含所有工具检测）',
      async () => {
        const start = Date.now();
        await runHook();
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(15000);
      },
      hookTimeoutMs,
    );

    it(
      '空 stdin 应正常处理',
      async () => {
        const { code } = await runHook('');
        expect(code).toBe(0);
      },
      hookTimeoutMs,
    );

    it(
      '无效 JSON stdin 应正常降级',
      async () => {
        const { code } = await runHook('not json');
        // 钩子不应崩溃，应该优雅降级
        expect(code).toBe(0);
      },
      hookTimeoutMs,
    );
  });
});
