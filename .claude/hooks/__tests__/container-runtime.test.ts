import { describe, it, expect } from 'bun:test';
import { DECISION } from '../security-orchestrator.js';
import {
  resolveContainerRuntime,
  getComposeConfigCmd,
  denyIfContainerRuntimeMissing,
  getContainerRuntimeInstallHint,
} from '../checks/container-runtime.js';

describe('container-runtime', () => {
  it('getComposeConfigCmd 应返回 compose config 命令格式', () => {
    const runtime = resolveContainerRuntime(process.cwd());
    if (!runtime) {
      expect(getComposeConfigCmd('docker-compose.yml', process.cwd())).toBeNull();
      return;
    }
    const cmd = getComposeConfigCmd('docker-compose.yml', process.cwd());
    expect(cmd).toBe(`${runtime.binary} compose -f "docker-compose.yml" config --quiet`);
  });

  it('resolveContainerRuntime 在 PATH 为空时应返回 null', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    expect(resolveContainerRuntime(process.cwd())).toBeNull();
    process.env.PATH = originalPath;
  });

  it('denyIfContainerRuntimeMissing 在无运行时时应 deny 并含安装指引', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    const result = denyIfContainerRuntimeMissing('test-compose', process.cwd());
    process.env.PATH = originalPath;
    expect(result).not.toBeNull();
    expect(result?.decision).toBe(DECISION.DENY);
    expect(result?.message).toContain('podman');
    expect(result?.message).toContain('docker');
  });

  it('denyIfContainerRuntimeMissing 在有运行时时应返回 null', () => {
    const runtime = resolveContainerRuntime(process.cwd());
    if (!runtime) return;
    expect(denyIfContainerRuntimeMissing('test-compose', process.cwd())).toBeNull();
  });

  it('getComposeConfigCmd 应包含 config --quiet', () => {
    const runtime = resolveContainerRuntime(process.cwd());
    if (!runtime) return;
    const cmd = getComposeConfigCmd('compose.yml', process.cwd());
    expect(cmd).toContain('config --quiet');
  });

  it('getContainerRuntimeInstallHint 应包含 podman 与 docker', () => {
    const hint = getContainerRuntimeInstallHint();
    expect(hint).toContain('podman');
    expect(hint).toContain('docker');
  });
});
