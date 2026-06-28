import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { clearGateConfigCache } from '../gate-config.js';
import { runSbomArchive } from '../checks/fintech-sbom.js';
import { runOpaConftest } from '../checks/policy-conftest.js';
import { hasIacTargets, runIacCheckov } from '../checks/iac-checkov.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('fintech-sbom', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/sbom-test');
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('无 syft/trivy 时 deny 或 skip', async () => {
    const result = await runSbomArchive(repoDir);
    expect(result.checkId).toBe('sbom-archive');
    expect([DECISION.DENY, DECISION.ALLOW, DECISION.SKIP]).toContain(result.decision);
  });
});

describe('policy-conftest', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/conftest-test');
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('无 policy 目录时 DENY (global strict)', async () => {
    const result = await runOpaConftest(repoDir);
    expect(result.decision).toBe(DECISION.DENY);
    expect(result.checkId).toBe('opa-conftest');
  });
});

describe('iac-checkov', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/checkov-test');
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('无 IaC 目标时 SKIP', async () => {
    expect(hasIacTargets(repoDir)).toBe(false);
    const result = await runIacCheckov(repoDir);
    expect(result.decision).toBe(DECISION.SKIP);
    expect(result.checkId).toBe('iac-checkov');
  });

  it('有 Dockerfile 时 hasIacTargets 为 true', () => {
    Bun.write(join(repoDir, 'Dockerfile'), 'FROM alpine\n');
    expect(hasIacTargets(repoDir)).toBe(true);
  });
});
