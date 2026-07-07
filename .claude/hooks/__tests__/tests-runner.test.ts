import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { runRelatedTests } from '../checks/tests.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';
import { DECISION } from '../security-orchestrator.js';

describe('runRelatedTests bun pattern', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/related-bun');
    writeFileSync(join(repoDir, 'lib.ts'), 'export const v = 1;\n');
    writeFileSync(
      join(repoDir, 'lib.test.ts'),
      `import { it, expect } from 'bun:test';
import { v } from './lib.ts';
it('lib', () => { expect(v).toBe(1); });`,
    );
    execSync('git add lib.ts lib.test.ts', { cwd: repoDir });
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('关联 js 测试 ALLOW', async () => {
    const r = await runRelatedTests(repoDir);
    expect(r.decision).toBe(DECISION.ALLOW);
  }, 30_000);
});
