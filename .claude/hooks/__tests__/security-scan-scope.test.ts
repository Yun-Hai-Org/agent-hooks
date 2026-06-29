import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getGitIgnoredDirs, evaluateTrivyJson, evaluateSemgrepOutput } from '../checks/security-scan.js';
import { clearGateConfigCache, resolveLicenseDenylist } from '../gate-config.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('getGitIgnoredDirs', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/git-ignore');
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('空仓库返回数组', () => {
    const dirs = getGitIgnoredDirs(repoDir);
    expect(Array.isArray(dirs)).toBe(true);
  });
});

describe('evaluateTrivyJson licenseDenylist', () => {
  it('denylist 命中 GPL 应 DENY', () => {
    const json = JSON.stringify({
      Results: [{ Licenses: [{ Name: 'GPL-3.0', PkgName: 'bad-pkg' }] }],
    });
    const r = evaluateTrivyJson(json, ['GPL-3.0']);
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('denylist');
  });

  it('denylist 未命中且无 blocking severity 时 ALLOW', () => {
    const json = JSON.stringify({
      Results: [{ Licenses: [{ Name: 'MIT', PkgName: 'ok-pkg' }] }],
    });
    const r = evaluateTrivyJson(json, ['GPL-3.0']);
    expect(r.decision).toBe(DECISION.ALLOW);
  });
});

describe('evaluateSemgrepOutput', () => {
  it('无 findings 返回 null', () => {
    expect(evaluateSemgrepOutput('{"results":[]}', 'semgrep')).toBeNull();
  });
});

describe('yaml licenseDenylist integration', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/lic-deny');
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('settings.licenseDenylist 可被 evaluateTrivyJson 使用', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  licenseDenylist:
    - AGPL-3.0
`,
    );
    clearGateConfigCache();
    const json = JSON.stringify({
      Results: [{ Licenses: [{ Name: 'AGPL-3.0', Severity: 'HIGH' }] }],
    });
    const r = evaluateTrivyJson(json, resolveLicenseDenylist(repoDir));
    expect(r.decision).toBe(DECISION.DENY);
  });
});
