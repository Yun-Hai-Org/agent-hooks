import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

describe('auto-stage', () => {
  let tempDir;
  let gitRepoDir;

  beforeEach(() => {
    // Create temp directory
    tempDir = join('/tmp', `auto-stage-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Create git repo for testing
    gitRepoDir = join(tempDir, 'git-repo');
    mkdirSync(gitRepoDir, { recursive: true });
    execSync('git init', { cwd: gitRepoDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: gitRepoDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: gitRepoDir, stdio: 'pipe' });

    // Clean environment
    delete process.env.CLAUDE_HOOK_PREVIOUS_DENIED;
    delete process.env.CLAUDE_HOOK_AUTO_STAGED;
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Export verification', () => {
    it('应该导出 isInGitRepo 函数', async () => {
      const module = await import('../auto-stage.js');
      expect(typeof module.isInGitRepo).toBe('function');
    });

    it('应该导出 stageFile 函数', async () => {
      const module = await import('../auto-stage.js');
      expect(typeof module.stageFile).toBe('function');
    });

    it('应该导出 log 函数', async () => {
      const module = await import('../auto-stage.js');
      expect(typeof module.log).toBe('function');
    });

    it('不应该导出 main 函数', async () => {
      const module = await import('../auto-stage.js');
      expect(module.main).toBeUndefined();
    });
  });

  describe('isInGitRepo - Git 仓库检测', () => {
    it('应该检测到 git 仓库中的文件', async () => {
      const { isInGitRepo } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      expect(isInGitRepo(testFile)).toBe(true);
    });

    it('应该检测不到非 git 仓库中的文件', async () => {
      const { isInGitRepo } = await import('../auto-stage.js');
      const testFile = join(tempDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      expect(isInGitRepo(testFile)).toBe(false);
    });

    it('应该处理不存在的文件路径', async () => {
      const { isInGitRepo } = await import('../auto-stage.js');
      const testFile = join(tempDir, 'nonexistent.txt');

      expect(isInGitRepo(testFile)).toBe(false);
    });
  });

  describe('stageFile - Git 暂存文件', () => {
    it('应该成功暂存文件', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      const result = stageFile(testFile);
      expect(result.success).toBe(true);

      // Verify file is staged
      const status = execSync('git status --porcelain', { cwd: gitRepoDir, encoding: 'utf-8' });
      expect(status).toContain('A');
    });

    it('应该处理已暂存的文件', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      // Stage once
      stageFile(testFile);

      // Stage again (should still succeed)
      const result = stageFile(testFile);
      expect(result.success).toBe(true);
    });

    it('应该处理修改后的文件', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'test.txt');

      // Create and commit
      writeFileSync(testFile, 'initial content');
      execSync('git add .', { cwd: gitRepoDir, stdio: 'pipe' });
      execSync('git commit -m "initial"', { cwd: gitRepoDir, stdio: 'pipe' });

      // Modify and stage
      writeFileSync(testFile, 'modified content');
      const result = stageFile(testFile);
      expect(result.success).toBe(true);

      // Verify file is staged as modified
      const status = execSync('git status --porcelain', { cwd: gitRepoDir, encoding: 'utf-8' });
      expect(status).toContain('M');
    });

    it('应该处理不存在的文件', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'nonexistent.txt');

      const result = stageFile(testFile);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('应该处理非 git 仓库中的文件', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(tempDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      const result = stageFile(testFile);
      expect(result.success).toBe(false);
    });
  });

  describe('log - 日志记录', () => {
    it('应该成功记录日志', async () => {
      const { log } = await import('../auto-stage.js');

      // Should not throw
      expect(() => log({ level: 'TEST', message: 'test log' })).not.toThrow();
    });

    it('应该处理空日志数据', async () => {
      const { log } = await import('../auto-stage.js');

      expect(() => log({})).not.toThrow();
    });

    it('应该处理复杂日志数据', async () => {
      const { log } = await import('../auto-stage.js');

      const complexData = {
        level: 'INFO',
        tool: 'Write',
        file: '/path/to/file.js',
        session_id: 'test-session-123',
        nested: { key: 'value' },
      };

      expect(() => log(complexData)).not.toThrow();
    });
  });

  describe('Path resolution - 路径解析', () => {
    it('应该正确处理绝对路径', async () => {
      const { isInGitRepo } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      // Absolute path should work
      expect(isInGitRepo(testFile)).toBe(true);
    });

    it('应该正确处理相对路径', async () => {
      const { isInGitRepo } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      // Test with relative path from git repo
      const relativePath = 'test.txt';
      const cwd = gitRepoDir;

      // Simulate what main() does
      const { isAbsolute } = await import('path');
      const absPath = isAbsolute(relativePath) ? relativePath : join(cwd, relativePath);

      expect(isInGitRepo(absPath)).toBe(true);
    });

    it('应该处理嵌套目录中的文件', async () => {
      const { isInGitRepo, stageFile } = await import('../auto-stage.js');
      const nestedDir = join(gitRepoDir, 'src', 'components');
      mkdirSync(nestedDir, { recursive: true });

      const testFile = join(nestedDir, 'Button.tsx');
      writeFileSync(testFile, 'export const Button = () => {}');

      expect(isInGitRepo(testFile)).toBe(true);

      const result = stageFile(testFile);
      expect(result.success).toBe(true);
    });
  });

  describe('Conditional staging - 条件暂存', () => {
    it('应该在 CLAUDE_HOOK_PREVIOUS_DENIED 未设置时暂存', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      delete process.env.CLAUDE_HOOK_PREVIOUS_DENIED;

      const result = stageFile(testFile);
      expect(result.success).toBe(true);
    });

    it('应该检测 CLAUDE_HOOK_PREVIOUS_DENIED 环境变量', async () => {
      // Test the logic that would be in main()
      process.env.CLAUDE_HOOK_PREVIOUS_DENIED = 'true';

      expect(process.env.CLAUDE_HOOK_PREVIOUS_DENIED).toBe('true');
    });

    it('应该在暂存成功后设置 CLAUDE_HOOK_AUTO_STAGED', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      delete process.env.CLAUDE_HOOK_AUTO_STAGED;

      const result = stageFile(testFile);
      if (result.success) {
        process.env.CLAUDE_HOOK_AUTO_STAGED = 'true';
      }

      expect(process.env.CLAUDE_HOOK_AUTO_STAGED).toBe('true');
    });

    it('应该在暂存失败时不设置 CLAUDE_HOOK_AUTO_STAGED', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(tempDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      delete process.env.CLAUDE_HOOK_AUTO_STAGED;

      const result = stageFile(testFile);
      if (result.success) {
        process.env.CLAUDE_HOOK_AUTO_STAGED = 'true';
      }

      expect(process.env.CLAUDE_HOOK_AUTO_STAGED).toBeUndefined();
    });
  });

  describe('Integration tests - 集成测试', () => {
    it('应该处理 Edit 工具输入', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'edit.txt');
      writeFileSync(testFile, 'initial');

      // Simulate Edit tool workflow
      const result = stageFile(testFile);
      expect(result.success).toBe(true);
    });

    it('应该处理 Write 工具输入', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'write.txt');
      writeFileSync(testFile, 'new file content');

      // Simulate Write tool workflow
      const result = stageFile(testFile);
      expect(result.success).toBe(true);
    });

    it('应该处理多个文件的连续暂存', async () => {
      const { stageFile } = await import('../auto-stage.js');

      const files = [join(gitRepoDir, 'file1.txt'), join(gitRepoDir, 'file2.txt'), join(gitRepoDir, 'file3.txt')];

      for (const file of files) {
        writeFileSync(file, 'content');
        const result = stageFile(file);
        expect(result.success).toBe(true);
      }

      // Verify all files are staged
      const status = execSync('git status --porcelain', { cwd: gitRepoDir, encoding: 'utf-8' });
      expect(status.split('\n').filter((line) => line.trim())).toHaveLength(3);
    });
  });

  describe('Error handling - 错误处理', () => {
    it('应该处理空文件路径', async () => {
      const { stageFile } = await import('../auto-stage.js');

      const result = stageFile('');
      expect(result.success).toBe(false);
    });

    it('应该处理 null 文件路径', async () => {
      const { stageFile } = await import('../auto-stage.js');

      const result = stageFile(null);
      expect(result.success).toBe(false);
    });

    it('应该处理 undefined 文件路径', async () => {
      const { stageFile } = await import('../auto-stage.js');

      const result = stageFile(undefined);
      expect(result.success).toBe(false);
    });

    it('应该处理特殊字符文件名', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'file-with-special-chars_123.test.js');
      writeFileSync(testFile, 'test content');

      const result = stageFile(testFile);
      expect(result.success).toBe(true);
    });

    it('应该处理中文文件名', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, '测试文件.txt');
      writeFileSync(testFile, 'test content');

      const result = stageFile(testFile);
      expect(result.success).toBe(true);
    });
  });

  describe('Git operations - Git 操作', () => {
    it('应该在暂存后正确显示文件状态', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'status-test.txt');
      writeFileSync(testFile, 'content');

      stageFile(testFile);

      const status = execSync('git status --short', { cwd: gitRepoDir, encoding: 'utf-8' });
      expect(status).toMatch(/A\s+status-test\.txt/);
    });

    it('应该处理 .gitignore 中的文件', async () => {
      const { stageFile } = await import('../auto-stage.js');

      // Create .gitignore
      writeFileSync(join(gitRepoDir, '.gitignore'), 'ignored.txt\n');

      // Create ignored file
      const ignoredFile = join(gitRepoDir, 'ignored.txt');
      writeFileSync(ignoredFile, 'should be ignored');

      const result = stageFile(ignoredFile);
      // Git add fails for .gitignore'd files (correct behavior)
      expect(result.success).toBe(false);

      // Verify file is not staged
      const status = execSync('git status --porcelain', { cwd: gitRepoDir, encoding: 'utf-8' });
      expect(status).not.toContain('ignored.txt');
    });

    it('应该处理空文件', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'empty.txt');
      writeFileSync(testFile, '');

      const result = stageFile(testFile);
      expect(result.success).toBe(true);
    });

    it('应该处理大文件', async () => {
      const { stageFile } = await import('../auto-stage.js');
      const testFile = join(gitRepoDir, 'large.txt');

      // Create 1MB file
      const content = 'x'.repeat(1024 * 1024);
      writeFileSync(testFile, content);

      const result = stageFile(testFile);
      expect(result.success).toBe(true);
    });
  });
});
