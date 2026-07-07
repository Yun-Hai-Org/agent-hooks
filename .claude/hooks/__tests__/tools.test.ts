import { describe, it, expect } from 'bun:test';
import { join } from 'path';
import { DECISION, getHookProcessEnv, execCommand } from '../security-orchestrator.js';
import {
  denyIfToolMissing,
  getBunxInvocation,
  getToolInstallHint,
  isToolInstalled,
  resolveBunExecutable,
  parseBunVersion,
  bunVersionAtLeast,
  MIN_BUN_AUDIT_VERSION,
  listBunExecutableCandidates,
} from '../checks/tools.js';

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

  it('getHookProcessEnv PATH 应包含 ~/.bun/bin', () => {
    const home = process.env['HOME'] ?? '';
    const env = getHookProcessEnv();
    const pathEntries = env['PATH']?.split(':') ?? [];
    expect(pathEntries).toContain(join(home, '.bun', 'bin'));
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

  it('isToolInstalled(bunx) 在窄 PATH 下仍可用（bun fallback）', () => {
    const originalPath = process.env['PATH'];
    process.env['PATH'] = '/nonexistent';
    try {
      expect(isToolInstalled('bunx')).toBe(true);
    } finally {
      process.env['PATH'] = originalPath;
    }
  });

  it('isToolInstalled(prettier) 在 bun 可用时应为 true', () => {
    if (!isToolInstalled('bun')) return;
    expect(isToolInstalled('prettier')).toBe(true);
  });

  it('getBunxInvocation 在窄 PATH 下应可执行 prettier --version', () => {
    const originalPath = process.env['PATH'];
    process.env['PATH'] = '/nonexistent';
    try {
      const bunx = getBunxInvocation();
      expect(bunx.length).toBeGreaterThan(0);
      const result = execCommand(`${bunx} prettier --version`, {
        env: getHookProcessEnv({ PATH: '/nonexistent' }),
      });
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toMatch(/^\d+\./);
    } finally {
      process.env['PATH'] = originalPath;
    }
  });

  it('resolveBunExecutable 应优先命中当前解释器、vendored 或 ~/.cursor/.bun', () => {
    const resolved = resolveBunExecutable();
    expect(resolved).not.toBe('bun');
    const fromKnownInstall =
      resolved === process.execPath ||
      resolved.includes('bun-darwin-x64') ||
      resolved.includes('.cursor') ||
      resolved.includes('.bun/bin');
    expect(fromKnownInstall).toBe(true);
  });

  it('parseBunVersion 应解析 semver', () => {
    expect(parseBunVersion('1.2.15')).toEqual({ major: 1, minor: 2, patch: 15 });
    expect(parseBunVersion('not-a-version')).toBeNull();
  });

  it('bunVersionAtLeast 应正确比较', () => {
    expect(bunVersionAtLeast({ major: 1, minor: 2, patch: 15 }, MIN_BUN_AUDIT_VERSION)).toBe(true);
    expect(bunVersionAtLeast({ major: 1, minor: 2, patch: 14 }, MIN_BUN_AUDIT_VERSION)).toBe(false);
  });

  it('listBunExecutableCandidates 应返回非空列表', () => {
    const candidates = listBunExecutableCandidates();
    expect(candidates.length).toBeGreaterThan(0);
  });
});
