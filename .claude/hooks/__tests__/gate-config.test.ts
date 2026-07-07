import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { clearGateConfigCache, resolveGateNode, loadGateConfig } from '../gate-config.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('gate-config', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/gate-config-test');
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('未配置节点 configured=false', () => {
    const node = resolveGateNode('git.pre-commit.checks.branch-check', repoDir);
    expect(node.configured).toBe(false);
  });

  it('白名单 enabled 解析', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `git:
  pre-commit:
    enabled: true
    checks:
      branch-check:
        enabled: true
`,
    );
    clearGateConfigCache();
    const node = resolveGateNode('git.pre-commit.checks.branch-check', repoDir);
    expect(node.configured).toBe(true);
    expect(node.enabled).toBe(true);
  });

  it('autoFix 继承父 hook', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `git:
  pre-commit:
    enabled: true
    autoFix: true
    checks:
      format-staged-prettier:
        enabled: true
`,
    );
    clearGateConfigCache();
    const node = resolveGateNode('git.pre-commit.checks.format-staged-prettier', repoDir);
    expect(node.autoFix).toBe(true);
  });

  it('父 disabled 时子节点 enabled=false', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `git:
  pre-commit:
    enabled: false
    checks:
      branch-check:
        enabled: true
`,
    );
    clearGateConfigCache();
    const node = resolveGateNode('git.pre-commit.checks.branch-check', repoDir);
    expect(node.configured).toBe(true);
    expect(node.enabled).toBe(false);
  });

  it('deep merge 全局与仓库配置', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `git:
  pre-commit:
    enabled: true
    timeout: 90s
`,
    );
    clearGateConfigCache();
    const config = loadGateConfig(repoDir);
    expect(config.git?.['pre-commit']?.enabled).toBe(true);
    const node = resolveGateNode('git.pre-commit', repoDir);
    expect(node.timeoutMs).toBe(90_000);
  });
});
