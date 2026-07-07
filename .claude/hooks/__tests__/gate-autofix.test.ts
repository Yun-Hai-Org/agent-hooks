import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { clearGateConfigCache } from '../gate-config.js';
import { AUTO_FIXABLE_CHECK_IDS, nodeSupportsAutoFix } from '../gate-registry.js';
import { getFixRunnerForPath, buildGateCheckPath } from '../gate-autofix.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('gate-autofix', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/autofix-test');
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('AUTO_FIXABLE_CHECK_IDS 包含 eslint/prettier', () => {
    expect(AUTO_FIXABLE_CHECK_IDS.has('lint-staged-eslint')).toBe(true);
    expect(AUTO_FIXABLE_CHECK_IDS.has('format-staged-prettier')).toBe(true);
  });

  it('nodeSupportsAutoFix 对 format-on-write prettier 为 true', () => {
    expect(nodeSupportsAutoFix('ide.format-on-write.checks.prettier')).toBe(true);
  });

  it('nodeSupportsAutoFix 对 semgrep 为 false', () => {
    expect(nodeSupportsAutoFix('git.pre-commit.checks.semgrep-staged')).toBe(false);
  });

  it('getFixRunnerForPath 返回 eslint fix runner', () => {
    const path = buildGateCheckPath('git.pre-commit', 'lint-staged-eslint');
    expect(getFixRunnerForPath(path)).toBeDefined();
  });

  it('未配置 autoFix 时 isGateNodeAutoFixEnabled 为 false', async () => {
    const { isGateNodeAutoFixEnabled } = await import('../gate-config.js');
    const path = buildGateCheckPath('git.pre-commit', 'lint-staged-eslint');
    expect(isGateNodeAutoFixEnabled(path, repoDir)).toBe(false);
  });

  it('配置 autoFix: true 后 isGateNodeAutoFixEnabled 为 true', async () => {
    const { isGateNodeAutoFixEnabled } = await import('../gate-config.js');
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `git:
  pre-commit:
    enabled: true
    autoFix: true
    checks:
      lint-staged-eslint:
        enabled: true
`,
    );
    clearGateConfigCache();
    const path = buildGateCheckPath('git.pre-commit', 'lint-staged-eslint');
    expect(isGateNodeAutoFixEnabled(path, repoDir)).toBe(true);
  });
});
