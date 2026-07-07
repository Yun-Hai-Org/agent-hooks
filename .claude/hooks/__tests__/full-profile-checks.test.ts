import { describe, it, expect } from 'bun:test';
import { runConfiguredCheck } from '../quality-gate.js';
import { runGitleaks, runSemgrep, runTrivy, runKnip, runSemgrepPciFull } from '../checks/security-scan.js';
import { runDepAudit } from '../checks/dependency.js';
import { runPyDepAudit } from '../checks/py-dep-audit.js';
import { runCodeReview } from '../checks/code-review.js';
import { runPaymentPageFull } from '../checks/payment-page-lint.js';
import { runSbomArchive } from '../checks/fintech-sbom.js';
import { runZapApiDast } from '../checks/zap-api-dast.js';
import { runOpaConftest } from '../checks/policy-conftest.js';
import { runIacCheckov } from '../checks/iac-checkov.js';
import { runSlsaCosign } from '../checks/slsa-cosign.js';
import { runOpenApiAuthNegative } from '../checks/openapi-auth-negative.js';
import { runLockfileFreshness } from '../checks/lockfile.js';
import { DECISION } from '../security-orchestrator.js';
import type { CheckResult } from '../types.js';
import { PROJECT_ROOT } from './helpers.js';

const gatePathPrefix = 'git.pre-push' as const;
const cwd = PROJECT_ROOT;

async function runFullCheck(checkId: string, runner: (ms?: number) => Promise<CheckResult> | CheckResult) {
  return runConfiguredCheck({ gatePathPrefix, checkId, cwd, runner: (ms) => runner(ms) });
}

describe('full profile runConfiguredCheck smoke', () => {
  const cases: [string, (ms?: number) => Promise<CheckResult> | CheckResult][] = [
    ['gitleaks', (ms) => runGitleaks(cwd, { timeoutMs: ms })],
    ['semgrep', (ms) => runSemgrep(cwd, { timeoutMs: ms })],
    ['trivy', (ms) => runTrivy(cwd, { timeoutMs: ms })],
    ['knip', (ms) => runKnip(cwd, { timeoutMs: ms })],
    ['dep-audit', (ms) => runDepAudit(cwd, { staged: false, timeoutMs: ms })],
    ['py-dep-audit', (ms) => runPyDepAudit(cwd, { timeoutMs: ms })],
    ['code-review', (ms) => runCodeReview(cwd, { staged: false, timeoutMs: ms })],
    ['lockfile-freshness', (ms) => runLockfileFreshness(cwd, { staged: false, timeoutMs: ms })],
    ['sbom-archive', () => runSbomArchive(cwd)],
    ['semgrep-pci', (ms) => runSemgrepPciFull(cwd, { timeoutMs: ms })],
    ['payment-page-full', () => runPaymentPageFull(cwd)],
    ['zap-api-dast', (ms) => runZapApiDast(cwd, { timeoutMs: ms })],
    ['openapi-auth-negative', () => runOpenApiAuthNegative(cwd)],
    ['opa-conftest', () => runOpaConftest(cwd)],
    ['iac-checkov', () => runIacCheckov(cwd)],
    ['slsa-cosign', () => runSlsaCosign(cwd)],
  ];

  for (const [checkId, runner] of cases) {
    it(`${checkId} 可执行`, async () => {
      const r = await runFullCheck(checkId, runner);
      expect(r.checkId).toBe(checkId);
      expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP, DECISION.WARN]).toContain(r.decision);
    }, 180_000);
  }
});
