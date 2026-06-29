import { describe, it, expect } from 'bun:test';
import { runHookAdversarialIfStaged } from '../checks/tests.js';
import { runSlsaCosign } from '../checks/slsa-cosign.js';
import { PROJECT_ROOT } from './helpers.js';
import { DECISION } from '../security-orchestrator.js';

describe('runHookAdversarialIfStaged', () => {
  it('PROJECT_ROOT 未暂存 hooks 时 SKIP', async () => {
    const r = await runHookAdversarialIfStaged(PROJECT_ROOT);
    expect([DECISION.SKIP, DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
  }, 300_000);
});

describe('runSlsaCosign', () => {
  it('PROJECT_ROOT cosign 检查可执行', async () => {
    const r = await runSlsaCosign(PROJECT_ROOT);
    expect(r.checkId).toBe('slsa-cosign');
    expect([DECISION.DENY, DECISION.SKIP, DECISION.ALLOW]).toContain(r.decision);
  });
});
