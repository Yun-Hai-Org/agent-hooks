import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { clearGateConfigCache, resolveWorktreeSettings } from '../gate-config.js';
import { isIntegratorMerge } from '../checks/git-policy.js';

function shouldSkipIntegratorMergeFullGate(
  currentBranch: string,
  mergeSourceBranch: string | null,
  cwd: string,
): boolean {
  const settings = resolveWorktreeSettings(cwd);
  return isIntegratorMerge(currentBranch, mergeSourceBranch) && !settings.integratorMergeRequiresFull;
}

describe('pre-merge-commit integrator merge skip', () => {
  const tempDir = join('/tmp', `integrator-merge-${Date.now()}`);

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    clearGateConfigCache();
  });

  function writeSettings(integratorMergeRequiresFull: boolean): void {
    mkdirSync(join(tempDir, '.claude'), { recursive: true });
    writeFileSync(
      join(tempDir, '.claude/quality-gate.yaml'),
      [
        'settings:',
        '  worktree:',
        `    integratorMergeRequiresFull: ${integratorMergeRequiresFull}`,
      ].join('\n'),
      'utf-8',
    );
    clearGateConfigCache();
  }

  it('skips full gate for epic merging feat/*-task-* when integratorMergeRequiresFull is false', () => {
    writeSettings(false);
    expect(
      shouldSkipIntegratorMergeFullGate('feat/hooks-self-heal', 'feat/hooks-self-heal-task-1', tempDir),
    ).toBe(true);
  });

  it('does not skip when merge source is not a task branch', () => {
    writeSettings(false);
    expect(shouldSkipIntegratorMergeFullGate('feat/hooks-self-heal', 'feat/other-epic', tempDir)).toBe(false);
  });

  it('does not skip when integratorMergeRequiresFull is true', () => {
    writeSettings(true);
    expect(
      shouldSkipIntegratorMergeFullGate('feat/hooks-self-heal', 'feat/hooks-self-heal-task-1', tempDir),
    ).toBe(false);
  });

  it('isIntegratorMerge requires parent epic branch match', () => {
    expect(isIntegratorMerge('feat/epic', 'feat/epic-task-42')).toBe(true);
    expect(isIntegratorMerge('feat/other', 'feat/epic-task-42')).toBe(false);
    expect(isIntegratorMerge('feat/epic', null)).toBe(false);
  });
});
