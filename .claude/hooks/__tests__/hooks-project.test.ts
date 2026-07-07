import { describe, it, expect } from 'bun:test';
import { isHooksProject } from '../checks/hooks-project.js';
import { runHookUnitTests } from '../checks/tests.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo, writeFile, PROJECT_ROOT } from './helpers.js';

describe('hooks-project', () => {
  it('isHooksProject 对本仓库为 true', () => {
    expect(isHooksProject(PROJECT_ROOT)).toBe(true);
  });

  it('isHooksProject 对普通 temp repo 为 false', () => {
    const repoDir = createTempGitRepo('feat/plain');
    try {
      expect(isHooksProject(repoDir)).toBe(false);
    } finally {
      cleanupTempGitRepo(repoDir);
    }
  });

  it('runHookUnitTests 对非 hooks 项目 SKIP', async () => {
    const repoDir = createTempGitRepo('feat/plain');
    try {
      const result = await runHookUnitTests(repoDir);
      expect(result.decision).toBe(DECISION.SKIP);
      expect(result.message).toContain('非 hooks 项目');
    } finally {
      cleanupTempGitRepo(repoDir);
    }
  });

  it('isHooksProject 对含 marker 文件的 repo 为 true', () => {
    const repoDir = createTempGitRepo('feat/hooks-like');
    try {
      writeFile(repoDir, '.claude/hooks/quality-gate.ts', 'export {};\n');
      expect(isHooksProject(repoDir)).toBe(true);
    } finally {
      cleanupTempGitRepo(repoDir);
    }
  });
});
