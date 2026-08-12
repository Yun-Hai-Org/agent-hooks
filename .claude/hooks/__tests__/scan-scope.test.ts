import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  buildSemgrepExcludeFlags,
  buildTrivySkipDirArgs,
  resolveScanTargets,
  filterPathsByScope,
  getScanScope,
  getScopedStagedFiles,
  isRepoRelativePathInScope,
} from '../checks/scan-scope.js';
import { clearGateConfigCache } from '../gate-config.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('scan-scope', () => {
  const scope = {
    include: ['src/', 'lib/'],
    exclude: ['_bmad-output/', 'node_modules/'],
  };

  it('buildSemgrepExcludeFlags 生成 exclude 参数', () => {
    expect(buildSemgrepExcludeFlags(scope)).toContain('--exclude "_bmad-output/"');
    expect(buildSemgrepExcludeFlags(scope)).toContain('--exclude "node_modules/"');
  });

  it('buildTrivySkipDirArgs 生成 skip-dirs 参数', () => {
    expect(buildTrivySkipDirArgs(scope)).toContain('--skip-dirs "_bmad-output/"');
  });

  it('resolveScanTargets include 为空时返回 fallback', () => {
    expect(resolveScanTargets({ include: [], exclude: [] })).toBe('.');
    expect(resolveScanTargets({ include: [], exclude: [] }, 'src')).toBe('src');
  });

  it('resolveScanTargets include 非空时拼接路径', () => {
    expect(resolveScanTargets(scope)).toBe('"src" "lib"');
  });

  it('filterPathsByScope exclude 过滤', () => {
    const files = ['src/a.ts', '_bmad-output/x.md', 'README.md'];
    const filtered = filterPathsByScope(files, { include: [], exclude: ['_bmad-output/'] });
    expect(filtered).toEqual(['src/a.ts', 'README.md']);
  });

  it('filterPathsByScope include 限定范围', () => {
    const files = ['src/a.ts', 'lib/b.ts', 'other/c.ts'];
    const filtered = filterPathsByScope(files, scope);
    expect(filtered).toEqual(['src/a.ts', 'lib/b.ts']);
  });

  it('filterPathsByScope include 内仍受 exclude 约束', () => {
    const files = ['src/_bmad-output/x.ts', 'src/ok.ts'];
    const filtered = filterPathsByScope(files, {
      include: ['src/'],
      exclude: ['src/_bmad-output/'],
    });
    expect(filtered).toEqual(['src/ok.ts']);
  });
});

describe('getScanScope from yaml', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/scan-scope');
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('默认含内置 exclude', () => {
    const scope = getScanScope(repoDir);
    expect(scope.exclude).toContain('_bmad-output');
    expect(scope.exclude).toContain('node_modules');
    expect(scope.exclude).toContain('.worktrees');
  });

  it('yaml scanScope 合并 exclude', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  scanScope:
    exclude:
      - custom-ignore/
`,
    );
    clearGateConfigCache();
    const scope = getScanScope(repoDir);
    expect(scope.exclude).toContain('custom-ignore/');
  });

  it('isRepoRelativePathInScope 受 include 限制', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  scanScope:
    include:
      - dual-track-eval/
`,
    );
    clearGateConfigCache();
    expect(isRepoRelativePathInScope('dual-track-eval/a.py', repoDir)).toBe(true);
    expect(isRepoRelativePathInScope('eval-console/a.py', repoDir)).toBe(false);
  });

  it('getScopedStagedFiles 过滤 scope 外暂存文件', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  scanScope:
    include:
      - src/
`,
    );
    clearGateConfigCache();
    const scoped = filterPathsByScope(['src/a.ts', 'other/b.ts'], getScanScope(repoDir));
    expect(scoped).toEqual(['src/a.ts']);
    expect(getScopedStagedFiles).toBeDefined();
  });
});
