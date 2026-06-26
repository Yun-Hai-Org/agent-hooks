import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  getQualityGateExcludeReason,
  isQualityGateExcluded,
  HOOKS_EXCLUDE_FILE,
  QUALITY_GATE_CONFIG_KEY,
} from '../gate-exclude.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';
import { execSync } from 'child_process';

describe('gate-exclude', () => {
  let repoDir: string;
  let hadExcludeFile: boolean;
  let previousExcludeContent: string | null = null;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/exclude-test');
    hadExcludeFile = existsSync(HOOKS_EXCLUDE_FILE);
    if (hadExcludeFile) {
      previousExcludeContent = readFileSync(HOOKS_EXCLUDE_FILE, 'utf-8');
    }
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    if (hadExcludeFile && previousExcludeContent !== null) {
      writeFileSync(HOOKS_EXCLUDE_FILE, previousExcludeContent);
    } else if (existsSync(HOOKS_EXCLUDE_FILE)) {
      rmSync(HOOKS_EXCLUDE_FILE);
    }
    try {
      execSync(`git config --local --unset ${QUALITY_GATE_CONFIG_KEY}`, { cwd: repoDir });
    } catch {}
  });

  it('未排除时 isQualityGateExcluded 为 false', () => {
    if (existsSync(HOOKS_EXCLUDE_FILE)) rmSync(HOOKS_EXCLUDE_FILE);
    expect(isQualityGateExcluded(repoDir)).toBe(false);
    expect(getQualityGateExcludeReason(repoDir)).toBeNull();
  });

  it('git config hooks.qualityGate false 应排除', () => {
    execSync(`git config --local ${QUALITY_GATE_CONFIG_KEY} false`, { cwd: repoDir });
    expect(isQualityGateExcluded(repoDir)).toBe(true);
    expect(getQualityGateExcludeReason(repoDir)).toContain(QUALITY_GATE_CONFIG_KEY);
  });

  it('hooks-exclude 精确路径应排除', () => {
    writeFileSync(HOOKS_EXCLUDE_FILE, `${repoDir}\n`);
    expect(isQualityGateExcluded(repoDir)).toBe(true);
    expect(getQualityGateExcludeReason(repoDir)).toContain('hooks-exclude');
  });

  it('hooks-exclude 前缀匹配应排除子路径', () => {
    const parent = join(repoDir, '..');
    writeFileSync(HOOKS_EXCLUDE_FILE, `${parent}/\n`);
    expect(isQualityGateExcluded(repoDir)).toBe(true);
  });

  it('hooks-exclude 忽略 # 注释行', () => {
    writeFileSync(HOOKS_EXCLUDE_FILE, `# ${repoDir}\n/other/path\n`);
    expect(isQualityGateExcluded(repoDir)).toBe(false);
  });
});
