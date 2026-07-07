import { describe, it, expect, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import {
  hasKindSmokeOptIn,
  hasContainerfileInRepo,
  hasK8sManifestsInRepo,
  runK8sKindSmokeFull,
} from '../checks/k8s-kind-smoke.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo, writeFile } from './helpers.js';

describe('k8s-kind-smoke', () => {
  let repoPath: string | null = null;

  afterEach(() => {
    if (repoPath) {
      cleanupTempGitRepo(repoPath);
      repoPath = null;
    }
  });

  it('hasKindSmokeOptIn 应识别 opt-in 标记文件', () => {
    repoPath = createTempGitRepo();
    expect(hasKindSmokeOptIn(repoPath)).toBe(false);
    writeFile(repoPath, '.hooks/kind-smoke', '');
    expect(hasKindSmokeOptIn(repoPath)).toBe(true);
  });

  it('hasContainerfileInRepo 应识别 Dockerfile', () => {
    repoPath = createTempGitRepo();
    expect(hasContainerfileInRepo(repoPath)).toBe(false);
    writeFile(repoPath, 'Dockerfile', 'FROM alpine\n');
    execSync('git add Dockerfile && git commit -m "add dockerfile"', { cwd: repoPath });
    expect(hasContainerfileInRepo(repoPath)).toBe(true);
  });

  it('hasK8sManifestsInRepo 应识别 k8s manifest', () => {
    repoPath = createTempGitRepo();
    expect(hasK8sManifestsInRepo(repoPath)).toBe(false);
    writeFile(repoPath, 'k8s/deployment.yaml', 'apiVersion: apps/v1\nkind: Deployment\n');
    execSync('git add k8s/deployment.yaml && git commit -m "add k8s"', { cwd: repoPath });
    expect(hasK8sManifestsInRepo(repoPath)).toBe(true);
  });

  it('无 opt-in 时 runK8sKindSmokeFull 应 SKIP', async () => {
    repoPath = createTempGitRepo();
    const result = await runK8sKindSmokeFull(repoPath);
    expect(result.decision).toBe(DECISION.SKIP);
    expect(result.checkId).toBe('k8s-kind-smoke');
  });

  it('有 opt-in 但无 k8s manifest 时应 SKIP', async () => {
    repoPath = createTempGitRepo();
    writeFile(repoPath, '.hooks/kind-smoke', '');
    const result = await runK8sKindSmokeFull(repoPath);
    expect(result.decision).toBe(DECISION.SKIP);
    expect(result.message).toContain('K8s manifest');
  });
});
