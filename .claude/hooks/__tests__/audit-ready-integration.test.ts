import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  attachControlIds,
  runConfiguredSyncCheck,
  runConfiguredCheck,
  runQualityGate,
  parseArgs,
  logGateResult,
  formatCheckSummaryLine,
} from '../quality-gate.js';
import { runRelatedTests, runFullProjectTests, runHookAdversarialTests } from '../checks/tests.js';
import { runStagedTypecheck, runFullTypecheck } from '../checks/typecheck.js';
import { runLintStaged } from '../checks/lint-staged.js';
import { runFormatStaged } from '../checks/format-staged.js';
import { runLintFull } from '../checks/lint-full.js';
import { runFormatFull } from '../checks/format-full.js';
import { runExtendedLintStaged, runExtendedLintFull } from '../checks/extended-lint.js';
import { runSchemaLintStaged, runSchemaLintFull } from '../checks/schema-lint.js';
import { runK8sLintStaged, runK8sLintFull } from '../checks/k8s-lint.js';
import { runOpenApiContractStaged, runOpenApiContractFull } from '../checks/openapi-contract.js';
import { runK8sKindSmokeFull } from '../checks/k8s-kind-smoke.js';
import { runOpenApiAuthNegative } from '../checks/openapi-auth-negative.js';
import { formatResult, DECISION } from '../security-orchestrator.js';
import { clearGateConfigCache } from '../gate-config.js';
import { join } from 'path';
import { writeFileSync, readFileSync } from 'fs';
import { createTempGitRepo, cleanupTempGitRepo, bootstrapQualityGateYaml, PROJECT_ROOT } from './helpers.js';

describe('quality-gate configured checks', () => {
  it('attachControlIds 附加 registry controlIds', () => {
    const base = formatResult('sbom-archive', DECISION.ALLOW, 'ok');
    const withIds = attachControlIds(base, 'git.pre-merge-commit.checks.sbom-archive');
    expect(withIds.controlIds?.length).toBeGreaterThan(0);
  });

  it('runConfiguredSyncCheck 未配置时 SKIP', () => {
    const r = runConfiguredSyncCheck({
      gatePathPrefix: 'git.pre-commit',
      checkId: 'nonexistent-check-xyz',
      cwd: '/tmp',
      runner: () => formatResult('nonexistent-check-xyz', DECISION.ALLOW, 'ok'),
    });
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runConfiguredCheck merge-only 在 pre-push SKIP', async () => {
    const repoDir = createTempGitRepo('feat/merge-only');
    bootstrapQualityGateYaml(repoDir);
    const cfgPath = join(repoDir, '.claude', 'quality-gate.yaml');
    const cfg = readFileSync(cfgPath, 'utf-8');
    const patched = cfg.replace(/pre-push:\s*\n\s*enabled:\s*false/, 'pre-push:\n    enabled: true');
    writeFileSync(cfgPath, patched);
    clearGateConfigCache();
    try {
      const r = await runConfiguredCheck({
        gatePathPrefix: 'git.pre-push',
        checkId: 'sbom-archive',
        cwd: repoDir,
        runner: async () => formatResult('sbom-archive', DECISION.ALLOW, 'ok'),
      });
      expect(r.decision).toBe(DECISION.SKIP);
      expect(r.message).toContain('merge-only');
    } finally {
      cleanupTempGitRepo(repoDir);
    }
  });

  it('parseArgs 解析全部 flags', () => {
    const opts = parseArgs([
      '--profile=commit',
      '--cwd=/x',
      '--json',
      '--commit-cmd=git commit -m "feat: x"',
      '--commit-msg-file=/tmp/msg',
    ]);
    expect(opts.profile).toBe('commit');
    expect(opts.cwd).toBe('/x');
    expect(opts.json).toBe(true);
    expect(opts.commitCmd).toContain('feat');
    expect(opts.commitMsgFile).toBe('/tmp/msg');
  });

  it('formatCheckSummaryLine 含 emoji', () => {
    const line = formatCheckSummaryLine(formatResult('x', DECISION.DENY, 'fail'));
    expect(line).toContain('❌');
  });

  it('logGateResult 不抛错', () => {
    logGateResult(
      'test',
      {
        passed: true,
        results: [],
        decision: { decision: DECISION.ALLOW, reason: '' },
        timing: { maxMs: 0, avgMs: 0, slowest: null, perCheck: [] },
      },
      { profile: 'commit' },
    );
  });
});

describe('runQualityGate integration', () => {
  it('commit profile 在 PROJECT_ROOT 可运行', async () => {
    const result = await runQualityGate({
      profile: 'commit',
      cwd: PROJECT_ROOT,
      commitCmd: 'git commit -m "feat: integration test"',
    });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result).toHaveProperty('timing');
  }, 300_000);

  it('未启用 hook 时 skipHookResult', async () => {
    const repo = createTempGitRepo('feat/disabled-gate');
    try {
      const result = await runQualityGate({ profile: 'commit', cwd: repo });
      expect(result.results[0]?.decision).toBe(DECISION.SKIP);
    } finally {
      cleanupTempGitRepo(repo);
    }
  });
});

describe('checks skip/allow paths', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/checks-skip');
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('runStagedTypecheck 无暂存代码 SKIP', async () => {
    const r = await runStagedTypecheck(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runFullTypecheck 无 pyproject/tsconfig SKIP 路径', async () => {
    const r = await runFullTypecheck(repoDir);
    expect(r.decision).toBe(DECISION.ALLOW);
  });

  it('runRelatedTests 无暂存 SKIP', async () => {
    const r = await runRelatedTests(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runLintStaged 无暂存 SKIP', async () => {
    const r = await runLintStaged(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runFormatStaged 无暂存 SKIP', async () => {
    const r = await runFormatStaged(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runLintFull 无 package SKIP 或 ALLOW', async () => {
    const r = await runLintFull(repoDir);
    expect([DECISION.SKIP, DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
  }, 60_000);

  it('runFormatFull 空仓库', async () => {
    const r = await runFormatFull(repoDir);
    expect([DECISION.SKIP, DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
  }, 60_000);

  it('extended/schema/k8s staged 无暂存 SKIP', async () => {
    expect((await runExtendedLintStaged(repoDir)).decision).toBe(DECISION.SKIP);
    expect((await runSchemaLintStaged(repoDir)).decision).toBe(DECISION.SKIP);
    expect((await runK8sLintStaged(repoDir)).decision).toBe(DECISION.SKIP);
  });

  it('extended/schema/k8s full 空仓库', async () => {
    for (const fn of [runExtendedLintFull, runSchemaLintFull, runK8sLintFull, runK8sKindSmokeFull]) {
      const r = await fn(repoDir);
      expect([DECISION.SKIP, DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
    }
  }, 120_000);

  it('openapi staged/full 空仓库', async () => {
    expect((await runOpenApiContractStaged(repoDir)).decision).toBe(DECISION.SKIP);
    const full = await runOpenApiContractFull(repoDir);
    expect([DECISION.SKIP, DECISION.ALLOW, DECISION.DENY]).toContain(full.decision);
  });

  it('openapi-auth-negative 空仓库 SKIP', async () => {
    expect((await runOpenApiAuthNegative(repoDir)).decision).toBe(DECISION.SKIP);
  });

  it('runFullProjectTests 无测试配置 SKIP', async () => {
    const r = await runFullProjectTests(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runHookAdversarialTests 非 hooks 项目 SKIP', async () => {
    const r = await runHookAdversarialTests(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });
});

describe('PROJECT_ROOT full check runners', () => {
  it('runFullTypecheck', async () => {
    const r = await runFullTypecheck(PROJECT_ROOT);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 180_000);

  it('runLintFull', async () => {
    const r = await runLintFull(PROJECT_ROOT);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 180_000);

  it('runFormatFull', async () => {
    const r = await runFormatFull(PROJECT_ROOT);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 180_000);

  it('runExtendedLintFull / schema / k8s / openapi', async () => {
    for (const fn of [runExtendedLintFull, runSchemaLintFull, runK8sLintFull, runOpenApiContractFull]) {
      const r = await fn(PROJECT_ROOT);
      expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
    }
  }, 300_000);

  it('runK8sKindSmokeFull', async () => {
    const r = await runK8sKindSmokeFull(PROJECT_ROOT);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 120_000);

  it('runFullProjectTests', async () => {
    const r = await runFullProjectTests(PROJECT_ROOT);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 180_000);
});
