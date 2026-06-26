import { describe, it, expect } from 'bun:test';
import { join } from 'path';
import { DECISION, getHookProcessEnv, execCommand } from '../security-orchestrator.js';
import { denyIfToolMissing, getToolInstallHint, isToolInstalled } from '../checks/tools.js';

describe('checks/tools', () => {
  it('denyIfToolMissing 对不存在的工具应 deny 并含安装指引', () => {
    const result = denyIfToolMissing('__nonexistent_tool_xyz__', 'test-tool', process.cwd());
    expect(result).not.toBeNull();
    expect(result?.decision).toBe(DECISION.DENY);
    expect(result?.message).toContain('未安装');
    expect(result?.message).toContain('请执行');
  });

  it('denyIfToolMissing 对已安装工具应返回 null', () => {
    const result = denyIfToolMissing('bun', 'test-tool', process.cwd());
    expect(result).toBeNull();
  });

  it('getToolInstallHint 应返回 ruff 安装命令', () => {
    expect(getToolInstallHint('ruff')).toContain('ruff');
  });

  it('execCommand 显式 PATH override 时不查找 augment 前缀路径', () => {
    const result = execCommand('command -v __nonexistent_tool_xyz__', {
      env: getHookProcessEnv({ PATH: '/nonexistent' }),
    });
    expect(result.success).toBe(false);
  });

  it('getHookProcessEnv PATH 应包含 ~/.cursor', () => {
    const home = process.env['HOME'] ?? '';
    const env = getHookProcessEnv();
    const pathEntries = env['PATH']?.split(':') ?? [];
    expect(pathEntries).toContain(join(home, '.cursor'));
  });

  it('isToolInstalled(bun) 在窄 PATH 下仍可用（~/.cursor/bun fallback）', () => {
    const originalPath = process.env['PATH'];
    process.env['PATH'] = '/nonexistent';
    try {
      expect(isToolInstalled('bun')).toBe(true);
    } finally {
      process.env['PATH'] = originalPath;
    }
  });
});
