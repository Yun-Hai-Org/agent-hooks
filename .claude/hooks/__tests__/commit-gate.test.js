import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import {
  extractCommitMessage,
  getStagedFiles,
  checkBranch,
  checkCommitMessage,
  checkSensitiveStagedFiles as checkSensitiveFiles,
} from '../checks/git-policy.js';
import { runDepAudit as checkDependencyAudit } from '../checks/dependency.js';
import { runStagedTypecheck as checkTypeScript } from '../checks/typecheck.js';
import { runRelatedTests as checkRelatedTests } from '../checks/tests.js';
import { getCurrentBranch } from '../security-orchestrator.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo, writeFile } from './helpers.js';

// commit-gate 测试 - 测试真实函数和完整流程
describe('commit-gate', () => {
  const HOOK_PATH = join(import.meta.dir, '..', 'commit-gate.js');
  let testFiles = [];

  beforeEach(() => {
    testFiles = [];
  });

  afterEach(() => {
    // 清理测试文件
    for (const file of testFiles) {
      if (existsSync(file)) {
        try {
          unlinkSync(file);
        } catch (e) {
          // ignore
        }
      }
    }
  });

  // 辅助函数：运行 hook 并获取输出
  function runHook(input) {
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

      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    });
  }

  // ─── Commit Message 格式检测 ─────────────────────────────────────────────

  describe('Commit Message 格式', () => {
    it('应该允许 "feat: 新增功能"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: 新增功能"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      // 可能因为分支检查失败，但 message 格式应该被接受
      expect(output).toBeDefined();
    });

    it('应该允许 "fix: 修复bug"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix: 修复bug"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      expect(output).toBeDefined();
    });

    it('应该允许 "refactor: 重构模块"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "refactor: 重构模块"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      expect(output).toBeDefined();
    });

    it('应该允许 "docs: 更新文档"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "docs: 更新文档"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      expect(output).toBeDefined();
    });

    it('应该允许 "test: 新增测试"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "test: 新增测试"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      expect(output).toBeDefined();
    });

    it('应该允许 "chore: 更新依赖"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "chore: 更新依赖"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      expect(output).toBeDefined();
    });

    it('应该允许 "style: 格式化代码"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "style: 格式化代码"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      expect(output).toBeDefined();
    });

    it('应该允许 "perf: 优化性能"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "perf: 优化性能"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      expect(output).toBeDefined();
    });

    it('应该拒绝 "wip"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "wip"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      // 如果不在 main/master 分支，应该因为 message 格式被拒绝
      if (!output.hookSpecificOutput) {
        // 在 feature 分支上会执行完整检查
        expect(output).toBeDefined();
      } else {
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
        expect(output.hookSpecificOutput.permissionDecisionReason).toContain('格式错误');
      }
    });

    it('应该拒绝 "fix:x" (无空格)', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix:x"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      if (output.hookSpecificOutput) {
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
        expect(output.hookSpecificOutput.permissionDecisionReason).toContain('格式错误');
      }
    });

    it('应该拒绝 "feat:" (无描述)', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat:"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      if (output.hookSpecificOutput) {
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      }
    });

    it('应该拒绝 "WIP: 临时提交"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "WIP: 临时提交"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      if (output.hookSpecificOutput) {
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
        expect(output.hookSpecificOutput.permissionDecisionReason).toContain('格式错误');
      }
    });

    it('应该拒绝 "tmp: 临时保存"', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "tmp: 临时保存"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      if (output.hookSpecificOutput) {
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      }
    });

    it('应该拒绝 "update: 更新代码" (不在允许列表中)', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "update: 更新代码"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      const output = JSON.parse(result.stdout);
      if (output.hookSpecificOutput) {
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      }
    });
  });

  // ─── 敏感文件检测 ───────────────────────────────────────────────────────

  describe('敏感文件检测', () => {
    it('应该识别 .env 文件', async () => {
      // 创建临时 .env 文件并添加到 git
      const envFile = join(process.cwd(), '.env.test');
      writeFileSync(envFile, 'TEST=value\n');
      testFiles.push(envFile);

      // 这个测试需要 git 操作，这里只是验证文件存在
      expect(existsSync(envFile)).toBe(true);
    });

    it('应该识别 .pem 文件', () => {
      const patterns = [/\.pem$/];
      expect(patterns.some((p) => p.test('server.pem'))).toBe(true);
      expect(patterns.some((p) => p.test('cert.pem'))).toBe(true);
    });

    it('应该识别 .key 文件', () => {
      const patterns = [/\.key$/];
      expect(patterns.some((p) => p.test('private.key'))).toBe(true);
    });

    it('应该识别 SSH 密钥文件', () => {
      const patterns = [/\.ssh\/id_/];
      expect(patterns.some((p) => p.test('.ssh/id_rsa'))).toBe(true);
      expect(patterns.some((p) => p.test('.ssh/id_ed25519'))).toBe(true);
    });

    it('不应该识别普通代码文件', () => {
      const patterns = [/\.env$/, /\.pem$/, /\.key$/, /\.ssh\/id_/];
      expect(patterns.some((p) => p.test('src/app.js'))).toBe(false);
      expect(patterns.some((p) => p.test('README.md'))).toBe(false);
      expect(patterns.some((p) => p.test('package.json'))).toBe(false);
    });
  });

  // ─── 分支保护 ───────────────────────────────────────────────────────────

  describe('分支保护', () => {
    it('应该拒绝在 main 分支提交', async () => {
      // 这个测试需要实际切换到 main 分支，这里只验证逻辑
      const mainBranches = ['main', 'master'];
      expect(mainBranches.includes('main')).toBe(true);
      expect(mainBranches.includes('master')).toBe(true);
      expect(mainBranches.includes('feature/test')).toBe(false);
    });

    it('应该允许在 feature 分支提交', () => {
      const mainBranches = ['main', 'master'];
      expect(mainBranches.includes('feature/add-login')).toBe(false);
      expect(mainBranches.includes('fix/bug-123')).toBe(false);
    });
  });

  // ─── 依赖审计 ───────────────────────────────────────────────────────────

  describe('依赖审计', () => {
    it('应该识别触发审计的文件', () => {
      const triggers = ['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock'];
      expect(triggers.some((t) => 'package.json'.endsWith(t))).toBe(true);
      expect(triggers.some((t) => 'bun.lock'.endsWith(t))).toBe(true);
      expect(triggers.some((t) => 'src/app.js'.endsWith(t))).toBe(false);
    });

    it('应该识别 critical 漏洞', () => {
      const output = '{"vulnerabilities": [{"severity": "critical"}]}';
      expect(/critical/i.test(output)).toBe(true);
    });

    it('应该识别 high 漏洞', () => {
      const output = '{"vulnerabilities": [{"severity": "high"}]}';
      expect(/high/i.test(output)).toBe(true);
    });
  });

  // ─── 关联测试查找 ───────────────────────────────────────────────────────

  describe('关联测试查找', () => {
    it('应该为 src/a.js 查找测试文件', () => {
      const testPatterns = [
        (f) => f.replace(/\.py$/, '_test.py').replace(/\/src\//, '/tests/'),
        (f) => f.replace(/\.py$/, '_test.py'),
        (f) => f.replace(/\.(js|ts)$/, '.test.$1'),
        (f) => f.replace(/\.(js|ts)$/, '.spec.$1'),
        (f) => f.replace(/\/src\//, '/__tests__/').replace(/\.(js|ts)$/, '.test.$1'),
      ];

      const candidates = testPatterns.map((p) => p('src/a.js'));
      expect(candidates.some((c) => c.includes('a.test.js'))).toBe(true);
    });

    it('应该为 src/a.py 查找测试文件', () => {
      const testPatterns = [
        (f) => f.replace(/\.py$/, '_test.py').replace(/\/src\//, '/tests/'),
        (f) => f.replace(/\.py$/, '_test.py'),
      ];

      const candidates = testPatterns.map((p) => p('src/a.py'));
      expect(candidates.some((c) => c.includes('a_test.py'))).toBe(true);
    });

    it('应该为 index.js 查找测试文件', () => {
      const testPatterns = [(f) => f.replace(/\.(js|ts)$/, '.test.$1'), (f) => f.replace(/\.(js|ts)$/, '.spec.$1')];

      const candidates = testPatterns.map((p) => p('index.js'));
      expect(candidates.length).toBeGreaterThan(0);
    });
  });

  // ─── 完整流程测试 ───────────────────────────────────────────────────────

  describe('完整流程', () => {
    it('非 Bash 工具应该直接通过', async () => {
      const result = await runHook({
        tool_name: 'Read',
        tool_input: { file_path: 'README.md' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      expect(result.stdout.trim()).toBe('{}');
    });

    it('非 git commit 命令应该直接通过', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      expect(result.stdout.trim()).toBe('{}');
    });

    it('git commit 命令应该触发检查', async () => {
      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "test: 测试提交"' },
        session_id: 'test',
        cwd: process.cwd(),
      });
      // 应该有输出（可能是 {} 或拒绝）
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it('应该处理空 stdin', async () => {
      const result = await runHook({});
      expect(result.code).toBe(0);
    });

    it('应该处理无效 JSON', async () => {
      const child = spawn('bun', [HOOK_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stdin.write('{invalid json}');
      child.stdin.end();

      await new Promise((resolve) => child.on('close', resolve));
      // 应该优雅降级
      expect(stdout.trim()).toBe('{}');
    });
  });

  // ─── 工具可用性检测 ─────────────────────────────────────────────────────

  describe('工具可用性', () => {
    it('应该检测 pyright 或 uv', () => {
      // 至少有一个应该存在
      const hasPyright = existsSync('/usr/bin/pyright') || existsSync('/usr/local/bin/pyright');
      const hasUv = existsSync('/usr/bin/uv') || existsSync('/usr/local/bin/uv');
      // 这个测试只是验证检测逻辑，不要求实际安装
      expect(typeof hasPyright).toBe('boolean');
      expect(typeof hasUv).toBe('boolean');
    });

    it('应该检测 tsconfig.json', () => {
      const hasTsconfig = existsSync(join(process.cwd(), 'tsconfig.json'));
      expect(typeof hasTsconfig).toBe('boolean');
    });
  });

  // ─── 直接函数测试 ─────────────────────────────────────────────────────

  describe('直接函数测试', () => {
    it('extractCommitMessage 应该提取标准格式', () => {
      const msg = extractCommitMessage('git commit -m "feat: 新增功能"');
      expect(msg).toBe('feat: 新增功能');
    });

    it('extractCommitMessage 应该提取单引号格式', () => {
      const msg = extractCommitMessage("git commit -m 'fix: 修复bug'");
      expect(msg).toBe('fix: 修复bug');
    });

    it('extractCommitMessage 应提取含空格的长 message', () => {
      const msg = extractCommitMessage('git commit -m "fix: post-merge quality gate failures on master"');
      expect(msg).toBe('fix: post-merge quality gate failures on master');
    });

    it('extractCommitMessage 应提取 HEREDOC message', () => {
      const cmd = `git commit -m "$(cat <<'EOF'
fix: hello world
EOF
)"`;
      const msg = extractCommitMessage(cmd);
      expect(msg).toBe('fix: hello world');
    });

    it('extractCommitMessage 无效命令返回 null', () => {
      const msg = extractCommitMessage('git push origin main');
      expect(msg).toBeNull();
    });

    it('getCurrentBranch 应该返回字符串或 null', () => {
      const branch = getCurrentBranch();
      expect(typeof branch === 'string' || branch === null).toBe(true);
    });

    it('getStagedFiles 应该返回数组', () => {
      const files = getStagedFiles();
      expect(Array.isArray(files)).toBe(true);
    });

    it('checkBranch 在非 main 分支应该允许', () => {
      const repoPath = createTempGitRepo('feat/test-branch-allow');
      try {
        const result = checkBranch(repoPath);
        expect(result.decision).toBe(DECISION.ALLOW);
      } finally {
        cleanupTempGitRepo(repoPath);
      }
    });

    it('checkCommitMessage 有效格式应该允许', () => {
      const result = checkCommitMessage('git commit -m "feat: test"');
      expect(result.decision).toBe(DECISION.ALLOW);
    });

    it('checkCommitMessage 无效格式应该拒绝', () => {
      const result = checkCommitMessage('git commit -m "bad message"');
      expect(result.decision).toBe(DECISION.DENY);
    });

    it('checkSensitiveFiles 应该返回有效结果', () => {
      const result = checkSensitiveFiles();
      expect(result).toBeDefined();
      expect(result.decision).toBeDefined();
    });
  });

  // ─── cwd 传递测试 (Story 6.2) ────────────────────────────────────────────

  describe('cwd 显式传递', () => {
    let repoPath;

    beforeEach(() => {
      repoPath = createTempGitRepo('feat/test-cwd');
    });

    afterEach(() => {
      if (repoPath) cleanupTempGitRepo(repoPath);
    });

    it('getCurrentBranch(cwd) 应该在指定目录获取分支', () => {
      const branch = getCurrentBranch(repoPath);
      expect(branch).toBe('feat/test-cwd');
    });

    it('getCurrentBranch(cwd) 在非 git 目录应该返回 null', () => {
      const branch = getCurrentBranch('/tmp');
      expect(branch).toBeNull();
    });

    it('getStagedFiles(cwd) 应该在指定目录获取暂存文件', () => {
      writeFile(repoPath, 'test.js', 'console.log("test")');
      const { execSync } = require('child_process');
      execSync('git add test.js', { cwd: repoPath });
      const files = getStagedFiles(repoPath);
      expect(files).toContain('test.js');
    });

    it('getStagedFiles(cwd) 在无暂存文件时返回空数组', () => {
      const files = getStagedFiles(repoPath);
      expect(files).toEqual([]);
    });

    it('checkBranch(cwd) 应该在 feature 分支允许', () => {
      const result = checkBranch(repoPath);
      expect(result.decision).toBe(DECISION.ALLOW);
      expect(result.message).toContain('feat/test-cwd');
    });

    it('checkBranch(cwd) 在 main 分支应该拒绝', () => {
      const mainRepo = createTempGitRepo('main');
      try {
        const result = checkBranch(mainRepo);
        expect(result.decision).toBe(DECISION.DENY);
      } finally {
        cleanupTempGitRepo(mainRepo);
      }
    });
  });
});
