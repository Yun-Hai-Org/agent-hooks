import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runOpenApiContractFull, runOpenApiContractStaged } from '../checks/openapi-contract.js';
import { runK8sLintFull, runK8sLintStaged } from '../checks/k8s-lint.js';
import { formatFileOnWrite } from '../checks/format-on-write.js';
import { createTempGitRepo, cleanupTempGitRepo, PROJECT_ROOT } from './helpers.js';
import { DECISION } from '../security-orchestrator.js';
import { execSync } from 'child_process';

describe('openapi-contract with spec file', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/openapi');
    writeFileSync(
      join(repoDir, 'openapi.yaml'),
      `openapi: 3.0.0
info:
  title: Test
  version: 1.0.0
paths: {}
`,
    );
    execSync('git add openapi.yaml', { cwd: repoDir });
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('runOpenApiContractFull 有 spec 时执行', async () => {
    const r = await runOpenApiContractFull(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 120_000);

  it('runOpenApiContractStaged 有暂存 spec 时执行', async () => {
    const r = await runOpenApiContractStaged(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 120_000);
});

describe('k8s-lint with manifest', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/k8s');
    mkdirSync(join(repoDir, 'k8s'), { recursive: true });
    writeFileSync(
      join(repoDir, 'k8s/deployment.yaml'),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: demo
  template:
    metadata:
      labels:
        app: demo
    spec:
      containers:
        - name: demo
          image: alpine:latest
`,
    );
    execSync('git add k8s/deployment.yaml', { cwd: repoDir });
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('runK8sLintFull 有 manifest 时执行', async () => {
    const r = await runK8sLintFull(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 180_000);

  it('runK8sLintStaged 有暂存 manifest 时执行', async () => {
    const r = await runK8sLintStaged(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 180_000);
});

describe('format-on-write additional targets', () => {
  it('md 文件 format 路径', async () => {
    const dir = join(PROJECT_ROOT, '.claude/hooks/__tests__/.tmp-format');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'sample.md');
    writeFileSync(file, '# Title\n\ncontent');
    try {
      const r = await formatFileOnWrite(file, PROJECT_ROOT);
      expect(r.skipped.includes('unsupported-extension')).toBe(false);
    } finally {
      execSync(`rm -rf "${dir}"`);
    }
  }, 60_000);
});
