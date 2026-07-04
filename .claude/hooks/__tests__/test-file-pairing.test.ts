import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { runTestFilePairing, candidateTestPaths, hasPairedTest } from '../checks/test-file-pairing.js';
import { clearGateConfigCache } from '../gate-config.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo, bootstrapQualityGateYaml } from './helpers.js';

describe('candidateTestPaths', () => {
  it('ts 文件生成 .test.ts 候选', () => {
    const paths = candidateTestPaths('.claude/hooks/checks/foo.ts');
    expect(paths).toContain('.claude/hooks/checks/foo.test.ts');
  });
});

describe('runTestFilePairing', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/pairing');
    bootstrapQualityGateYaml(repoDir);
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('无暂存文件 SKIP', () => {
    const r = runTestFilePairing(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('源码无配对测试 DENY', () => {
    mkdirSync(join(repoDir, '.claude/hooks/checks'), { recursive: true });
    writeFileSync(join(repoDir, '.claude/hooks/checks/new-module.ts'), 'export const x = 1;\n');
    execSync('git add .claude/hooks/checks/new-module.ts', { cwd: repoDir });
    const r = runTestFilePairing(repoDir);
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('缺少测试文件');
  });

  it('同 commit 暂存测试文件 ALLOW', () => {
    mkdirSync(join(repoDir, '.claude/hooks/checks'), { recursive: true });
    writeFileSync(join(repoDir, '.claude/hooks/checks/new-module.ts'), 'export const x = 1;\n');
    writeFileSync(
      join(repoDir, '.claude/hooks/checks/new-module.test.ts'),
      "import { describe, it } from 'bun:test';\ndescribe('x', () => { it('works', () => {}); });\n",
    );
    execSync('git add .claude/hooks/checks/new-module.ts .claude/hooks/checks/new-module.test.ts', { cwd: repoDir });
    const r = runTestFilePairing(repoDir);
    expect(r.decision).toBe(DECISION.ALLOW);
  });

  it('仓库已有测试文件 ALLOW', () => {
    mkdirSync(join(repoDir, '.claude/hooks/checks'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/hooks/checks/existing.test.ts'),
      "import { describe, it } from 'bun:test';\ndescribe('x', () => { it('works', () => {}); });\n",
    );
    execSync('git add .claude/hooks/checks/existing.test.ts', { cwd: repoDir });
    execSync('git commit -m "chore: test"', { cwd: repoDir });
    writeFileSync(join(repoDir, '.claude/hooks/checks/existing.ts'), 'export const x = 1;\n');
    execSync('git add .claude/hooks/checks/existing.ts', { cwd: repoDir });
    expect(hasPairedTest('.claude/hooks/checks/existing.ts', ['.claude/hooks/checks/existing.ts'], repoDir)).toBe(true);
    const r = runTestFilePairing(repoDir);
    expect(r.decision).toBe(DECISION.ALLOW);
  });
});
