import { describe, it, expect } from 'bun:test';
import { DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyIfPyrightMissing, getToolInstallHint } from '../checks/tools.js';

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

  it('denyIfPyrightMissing 在无 pyright/uv 时应 deny', () => {
    const originalWhich = process.env.PATH;
    process.env.PATH = '/nonexistent';
    const result = denyIfPyrightMissing('type-check', process.cwd());
    process.env.PATH = originalWhich;
    expect(result).not.toBeNull();
    expect(result?.decision).toBe(DECISION.DENY);
  });
});
