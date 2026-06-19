import { describe, it, expect } from 'bun:test';
import { DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyIfPyrightMissing } from '../checks/tools.js';

describe('checks/tools', () => {
  it('denyIfToolMissing 对不存在的工具应 deny', () => {
    const result = denyIfToolMissing('__nonexistent_tool_xyz__', 'test-tool', process.cwd());
    expect(result).not.toBeNull();
    expect(result?.decision).toBe(DECISION.DENY);
    expect(result?.message).toContain('未安装');
  });

  it('denyIfToolMissing 对已安装工具应返回 null', () => {
    const result = denyIfToolMissing('bun', 'test-tool', process.cwd());
    expect(result).toBeNull();
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
