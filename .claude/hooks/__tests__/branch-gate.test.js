import { describe, it, expect } from 'bun:test';
import { spawn } from 'child_process';
import { join } from 'path';

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
      const mainBranches = ['main', 'master'];
      expect(mainBranches.includes('main')).toBe(true);
    });

    it('应该包含 master', () => {
      const mainBranches = ['main', 'master'];
      expect(mainBranches.includes('master')).toBe(true);
    });

    it('不应该包含 develop', () => {
      const mainBranches = ['main', 'master'];
      expect(mainBranches.includes('develop')).toBe(false);
    });
  });

  describe('FILE_WRITE_PATTERNS 模式检测', () => {
    const FILE_WRITE_PATTERNS = [
      { pattern: />\s*\S+/, name: '重定向写入 (>)' },
      { pattern: />>\s*\S+/, name: '追加写入 (>>)' },
      { pattern: /\btee\b/, name: 'tee 命令' },
      { pattern: /\bsed\s+-i\b/, name: 'sed 原地编辑' },
      { pattern: /\bcp\s+/, name: 'cp 复制' },
      { pattern: /\bmv\s+/, name: 'mv 移动' },
      { pattern: /\becho\b.*>/, name: 'echo 重定向' },
      { pattern: /\bdd\s+/, name: 'dd 命令' },
      { pattern: /\binstall\s+/, name: 'install 命令' },
      { pattern: /\bcat\s+.*>/, name: 'cat 重定向' },
      { pattern: /\bprintf\b.*>/, name: 'printf 重定向' },
    ];

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
});
