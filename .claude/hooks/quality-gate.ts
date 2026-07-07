#!/usr/bin/env bun
/**
 * Quality Gate - 共享质量检查 CLI
 * profiles: commit | full
 */

import {
  decide,
  formatResult,
  log,
  timeCheck,
  DECISION,
  isGatePassed,
  getRepoHeadSha,
} from './security-orchestrator.js';
import {
  checkBranch,
  checkCommitMessage,
  checkCommitMessageFromFile,
  checkSensitiveStagedFiles,
} from './checks/git-policy.js';
import { runDepAudit } from './checks/dependency.js';
import { runStagedTypecheck, runFullTypecheck } from './checks/typecheck.js';
import {
  runRelatedTests,
  runFullProjectTests,
  runHookUnitTests,
  runHookAdversarialTests,
  runHookAdversarialIfStaged,
} from './checks/tests.js';
import {
  runSemgrep,
  runSemgrepStaged,
  runSemgrepPciStaged,
  runSemgrepPciFull,
  runKnip,
  runTrivy,
  runGitleaks,
  runGitleaksStaged,
} from './checks/security-scan.js';
import { runSbomArchive } from './checks/fintech-sbom.js';
import { runPaymentPageStaged, runPaymentPageFull } from './checks/payment-page-lint.js';
import { runZapApiDast } from './checks/zap-api-dast.js';
import { runOpenApiAuthNegative } from './checks/openapi-auth-negative.js';
import { runOpaConftest } from './checks/policy-conftest.js';
import { runIacCheckov } from './checks/iac-checkov.js';
import { runSlsaCosign } from './checks/slsa-cosign.js';
import { runPyDepAudit } from './checks/py-dep-audit.js';
import { runLockfileFreshness } from './checks/lockfile.js';
import { runLintFull } from './checks/lint-full.js';
import { runLintStaged } from './checks/lint-staged.js';
import { runFormatFull } from './checks/format-full.js';
import { runFormatStaged } from './checks/format-staged.js';
import { runCodeReview } from './checks/code-review.js';
import { runExtendedLintStaged, runExtendedLintFull } from './checks/extended-lint.js';
import { runSchemaLintStaged, runSchemaLintFull } from './checks/schema-lint.js';
import { runK8sLintStaged, runK8sLintFull } from './checks/k8s-lint.js';
import { runK8sKindSmokeFull } from './checks/k8s-kind-smoke.js';
import { resolveCoverageThresholds, resolveGateNode } from './gate-config.js';
import { runOpenApiContractStaged, runOpenApiContractFull } from './checks/openapi-contract.js';
import { getIndexTreeSha, recordFullPass } from './gate-cache.js';
import { getRegistryControlIds } from './gate-registry.js';

import type {
  QualityGateParseOptions,
  CheckResult,
  QualityGateResult,
  GateTiming,
  GateTimingEntry,
  GatePathPrefix,
} from './types.js';

export interface RunConfiguredCheckOptions {
  gatePathPrefix: GatePathPrefix;
  checkId: string;
  cwd: string;
  runner: (timeoutMs?: number) => Promise<CheckResult> | CheckResult;
}

export function attachControlIds(result: CheckResult, gatePath: string): CheckResult {
  const controlIds = getRegistryControlIds(gatePath);
  if (!controlIds || controlIds.length === 0) return result;
  return { ...result, controlIds };
}

export function runConfiguredSyncCheck(
  options: Omit<RunConfiguredCheckOptions, 'runner'> & {
    runner: () => CheckResult;
  },
): CheckResult {
  const path = `${options.gatePathPrefix}.checks.${options.checkId}`;
  const node = resolveGateNode(path, options.cwd);
  if (!node.configured || !node.enabled) {
    return formatResult(options.checkId, DECISION.SKIP, `未配置或已关闭 (${path})`);
  }
  const mergeSkip = skipMergeOnlyCheck(options.checkId, options.gatePathPrefix);
  if (mergeSkip) return attachControlIds(mergeSkip, path);
  return attachControlIds(options.runner(), path);
}

export async function runConfiguredCheck(options: RunConfiguredCheckOptions): Promise<CheckResult> {
  const path = `${options.gatePathPrefix}.checks.${options.checkId}`;
  const node = resolveGateNode(path, options.cwd);
  if (!node.configured || !node.enabled) {
    return formatResult(options.checkId, DECISION.SKIP, `未配置或已关闭 (${path})`);
  }
  const mergeSkip = skipMergeOnlyCheck(options.checkId, options.gatePathPrefix);
  if (mergeSkip) return attachControlIds(mergeSkip, path);
  const result = await options.runner(node.timeoutMs);
  return attachControlIds(result, path);
}

function skipHookResult(hookPath: string): QualityGateResult {
  const skip = formatResult('quality-gate', DECISION.SKIP, `${hookPath} 未在 quality-gate.yaml 中启用`);
  const decision = decide([skip]);
  const failClosed = hookPath === 'git.pre-push' || hookPath === 'git.pre-merge-commit';
  return { passed: !failClosed, results: [skip], decision, timing: computeTiming([skip]) };
}

const MERGE_ONLY_CHECK_IDS = new Set(['sbom-archive', 'slsa-cosign', 'payment-page-full']);

function skipMergeOnlyCheck(checkId: string, gatePathPrefix: GatePathPrefix): CheckResult | null {
  if (MERGE_ONLY_CHECK_IDS.has(checkId) && gatePathPrefix !== 'git.pre-merge-commit') {
    return formatResult(checkId, DECISION.SKIP, 'merge-only 检查，pre-push 跳过');
  }
  return null;
}

interface CheckFailureDetail {
  tool?: string;
  stdout?: string;
  stderr?: string;
}

function isCheckFailureDetail(value: unknown): value is CheckFailureDetail {
  return typeof value === 'object' && value !== null;
}

export function parseArgs(argv: string[]): QualityGateParseOptions {
  const options: QualityGateParseOptions = { profile: 'full', cwd: process.cwd(), json: false };
  for (const arg of argv) {
    if (arg.startsWith('--profile=')) {
      const p = arg.slice('--profile='.length);
      if (p === 'commit' || p === 'full') options.profile = p;
    } else if (arg.startsWith('--cwd=')) {
      options.cwd = arg.slice('--cwd='.length);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--commit-cmd=')) {
      options.commitCmd = arg.slice('--commit-cmd='.length);
    } else if (arg.startsWith('--commit-msg-file=')) {
      options.commitMsgFile = arg.slice('--commit-msg-file='.length);
    }
  }
  return options;
}

export function computeTiming(results: CheckResult[]): GateTiming {
  const perCheck: GateTimingEntry[] = [];
  for (const r of results) {
    if (typeof r.durationMs === 'number' && r.decision !== DECISION.SKIP) {
      perCheck.push({ checkId: r.checkId, ms: r.durationMs });
    }
  }
  let maxMs = 0;
  let sum = 0;
  let slowest: GateTimingEntry | null = null;
  for (const entry of perCheck) {
    sum += entry.ms;
    if (slowest === null || entry.ms > maxMs) {
      maxMs = entry.ms;
      slowest = entry;
    }
  }
  const avgMs = perCheck.length > 0 ? Math.round(sum / perCheck.length) : 0;
  return { maxMs, avgMs, slowest, perCheck };
}

export async function runQualityGate(
  options: Pick<QualityGateParseOptions, 'profile' | 'cwd'> & {
    commitCmd?: string;
    commitMsgFile?: string;
    gatePathPrefix?: GatePathPrefix;
    /** 测试专用：跳过指定 checkId（避免 hook-unit-tests 递归触发全量单测） */
    skipCheckIds?: string[];
  },
): Promise<QualityGateResult> {
  const { profile, cwd, commitCmd, commitMsgFile, skipCheckIds = [] } = options;
  const gatePathPrefix = options.gatePathPrefix ?? (profile === 'commit' ? 'git.pre-commit' : 'git.pre-push');

  const hookNode = resolveGateNode(gatePathPrefix, cwd);
  if (!hookNode.configured || !hookNode.enabled) {
    return skipHookResult(gatePathPrefix);
  }

  const checkOpts = { gatePathPrefix, cwd };

  if (profile === 'commit') {
    const syncResults = [
      runConfiguredSyncCheck({
        ...checkOpts,
        checkId: 'branch-check',
        runner: () => checkBranch(cwd),
      }),
      (() => {
        const commitMsgPath = 'git.commit-msg.checks.commit-msg';
        const commitMsgNode = resolveGateNode(commitMsgPath, cwd);
        if (!commitMsgNode.configured || !commitMsgNode.enabled) {
          return formatResult('commit-msg', DECISION.SKIP, `未配置或已关闭 (${commitMsgPath})`);
        }
        if (commitMsgFile) return checkCommitMessageFromFile(commitMsgFile);
        if (commitCmd) return checkCommitMessage(commitCmd);
        return formatResult('commit-msg', DECISION.SKIP, '无 commit message');
      })(),
      runConfiguredSyncCheck({
        ...checkOpts,
        checkId: 'sensitive-files',
        runner: () => checkSensitiveStagedFiles(cwd),
      }),
    ];
    const syncDecision = decide(syncResults);
    if (syncDecision.decision === DECISION.DENY) {
      return { passed: false, results: syncResults, decision: syncDecision, timing: computeTiming(syncResults) };
    }

    const [
      auditResult,
      typeResult,
      testResult,
      lintStaged,
      formatStaged,
      gitleaksStaged,
      semgrepStaged,
      codeReview,
      hookAdv,
      extendedLint,
      schemaLint,
      k8sLint,
      openApiContract,
      lockfileFreshness,
      semgrepPciStaged,
      paymentPageStaged,
    ] = await Promise.all([
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'dep-audit',
          runner: (ms) => runDepAudit(cwd, { staged: true, timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'type-check',
          runner: (ms) => runStagedTypecheck(cwd, { timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'related-tests',
          runner: (ms) => runRelatedTests(cwd, { timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'lint-staged',
          runner: (ms) => runLintStaged(cwd, { timeoutMs: ms, gatePathPrefix }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'format-staged',
          runner: (ms) => runFormatStaged(cwd, { timeoutMs: ms, gatePathPrefix }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'gitleaks-staged',
          runner: (ms) => runGitleaksStaged(cwd, { timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'semgrep-staged',
          runner: (ms) => runSemgrepStaged(cwd, { timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'code-review-staged',
          runner: (ms) => runCodeReview(cwd, { staged: true, timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'hook-adversarial',
          runner: (ms) => runHookAdversarialIfStaged(cwd, { timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'extended-staged',
          runner: (ms) => runExtendedLintStaged(cwd, { timeoutMs: ms, gatePathPrefix }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'schema-staged',
          runner: (ms) => runSchemaLintStaged(cwd, { timeoutMs: ms, gatePathPrefix }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'k8s-staged',
          runner: (ms) => runK8sLintStaged(cwd, { timeoutMs: ms, gatePathPrefix }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'openapi-staged',
          runner: (ms) => runOpenApiContractStaged(cwd, { timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'lockfile-freshness',
          runner: (ms) => runLockfileFreshness(cwd, { staged: true, timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'semgrep-pci-staged',
          runner: (ms) => runSemgrepPciStaged(cwd, { timeoutMs: ms }),
        }),
      ),
      timeCheck(
        runConfiguredSyncCheck({
          ...checkOpts,
          checkId: 'payment-page-staged',
          runner: () => runPaymentPageStaged(cwd),
        }),
      ),
    ]);
    const results = [
      ...syncResults,
      auditResult,
      typeResult,
      testResult,
      lintStaged,
      formatStaged,
      gitleaksStaged,
      semgrepStaged,
      codeReview,
      hookAdv,
      extendedLint,
      schemaLint,
      k8sLint,
      openApiContract,
      lockfileFreshness,
      semgrepPciStaged,
      paymentPageStaged,
    ];
    const finalDecision = decide(results);
    return {
      passed: isGatePassed(finalDecision.decision),
      results,
      decision: finalDecision,
      timing: computeTiming(results),
    };
  }

  const hookUnit = skipCheckIds.includes('hook-unit-tests')
    ? formatResult('hook-unit-tests', DECISION.SKIP, '测试跳过 hook-unit-tests')
    : await timeCheck(
        runConfiguredCheck({
          ...checkOpts,
          checkId: 'hook-unit-tests',
          runner: (ms) => runHookUnitTests(cwd, { coverageThreshold: resolveCoverageThresholds(cwd), timeoutMs: ms }),
        }),
      );
  const coverageResult = runConfiguredSyncCheck({
    ...checkOpts,
    checkId: 'coverage',
    runner: () => formatResult('coverage', DECISION.SKIP, '覆盖率已并入 hook-unit-tests（--coverage）'),
  });

  const [
    typeResult,
    lintResult,
    fullTests,
    hookAdv,
    depAudit,
    pyDepAudit,
    gitleaks,
    semgrep,
    knip,
    trivy,
    formatResult_,
    reviewResult,
    extendedLint,
    schemaLint,
    k8sLint,
    k8sKindSmoke,
    openApiContract,
    lockfileFreshness,
    sbomArchive,
    semgrepPci,
    paymentPageFull,
    zapApiDast,
    openapiAuthNegative,
    opaConftest,
    iacCheckov,
    slsaCosign,
  ] = await Promise.all([
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'type-check',
        runner: (ms) => runFullTypecheck(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'lint-full',
        runner: (ms) => runLintFull(cwd, { timeoutMs: ms, gatePathPrefix }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'full-tests',
        runner: (ms) => runFullProjectTests(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'hook-adversarial',
        runner: (ms) => runHookAdversarialTests(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'dep-audit',
        runner: (ms) => runDepAudit(cwd, { staged: false, timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'py-dep-audit',
        runner: (ms) => runPyDepAudit(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({ ...checkOpts, checkId: 'gitleaks', runner: (ms) => runGitleaks(cwd, { timeoutMs: ms }) }),
    ),
    timeCheck(
      runConfiguredCheck({ ...checkOpts, checkId: 'semgrep', runner: (ms) => runSemgrep(cwd, { timeoutMs: ms }) }),
    ),
    timeCheck(runConfiguredCheck({ ...checkOpts, checkId: 'knip', runner: (ms) => runKnip(cwd, { timeoutMs: ms }) })),
    timeCheck(runConfiguredCheck({ ...checkOpts, checkId: 'trivy', runner: (ms) => runTrivy(cwd, { timeoutMs: ms }) })),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'format-full',
        runner: (ms) => runFormatFull(cwd, { timeoutMs: ms, gatePathPrefix }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'code-review',
        runner: (ms) => runCodeReview(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'extended-full',
        runner: (ms) => runExtendedLintFull(cwd, { timeoutMs: ms, gatePathPrefix }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'schema-full',
        runner: (ms) => runSchemaLintFull(cwd, { timeoutMs: ms, gatePathPrefix }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'k8s-full',
        runner: (ms) => runK8sLintFull(cwd, { timeoutMs: ms, gatePathPrefix }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'k8s-kind-smoke',
        runner: (ms) => runK8sKindSmokeFull(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'openapi-full',
        runner: (ms) => runOpenApiContractFull(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'lockfile-freshness',
        runner: (ms) => runLockfileFreshness(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'sbom-archive',
        runner: (ms) => runSbomArchive(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'semgrep-pci',
        runner: (ms) => runSemgrepPciFull(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredSyncCheck({ ...checkOpts, checkId: 'payment-page-full', runner: () => runPaymentPageFull(cwd) }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'zap-api-dast',
        runner: (ms) => runZapApiDast(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'openapi-auth-negative',
        runner: (ms) => runOpenApiAuthNegative(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'opa-conftest',
        runner: (ms) => runOpaConftest(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'iac-checkov',
        runner: (ms) => runIacCheckov(cwd, { timeoutMs: ms }),
      }),
    ),
    timeCheck(
      runConfiguredCheck({
        ...checkOpts,
        checkId: 'slsa-cosign',
        runner: (ms) => runSlsaCosign(cwd, { timeoutMs: ms }),
      }),
    ),
  ]);

  const results = [
    typeResult,
    lintResult,
    fullTests,
    hookUnit,
    hookAdv,
    depAudit,
    pyDepAudit,
    gitleaks,
    semgrep,
    knip,
    trivy,
    formatResult_,
    coverageResult,
    reviewResult,
    extendedLint,
    schemaLint,
    k8sLint,
    k8sKindSmoke,
    openApiContract,
    lockfileFreshness,
    sbomArchive,
    semgrepPci,
    paymentPageFull,
    zapApiDast,
    openapiAuthNegative,
    opaConftest,
    iacCheckov,
    slsaCosign,
  ];
  const finalDecision = decide(results);
  return {
    passed: isGatePassed(finalDecision.decision),
    results,
    decision: finalDecision,
    timing: computeTiming(results),
  };
}

export const CHECK_DETAILS_LOG_MAX = 2000;

export function summarizeCheckDetails(details: Record<string, unknown> | undefined): string | undefined {
  if (!details || typeof details !== 'object') return undefined;

  const parts: string[] = [];
  if (typeof details['output'] === 'string' && details['output'].trim()) {
    parts.push(details['output'].trim());
  }
  if (Array.isArray(details['failures'])) {
    for (const failure of details['failures']) {
      if (!isCheckFailureDetail(failure)) continue;
      const text = [failure.stderr, failure.stdout]
        .filter((s) => typeof s === 'string' && s.trim())
        .join('\n')
        .trim();
      parts.push(text ? `${failure.tool ?? 'tool'}:\n${text}` : `${failure.tool ?? 'tool'}: failed`);
    }
  }
  if (Array.isArray(details['findings']) && details['findings'].length > 0) {
    parts.push(JSON.stringify(details['findings']));
  }
  if (Array.isArray(details['matched']) && details['matched'].length > 0) {
    parts.push(`matched: ${details['matched'].join(', ')}`);
  }
  if (typeof details['installHint'] === 'string' && details['installHint'].trim()) {
    parts.push(`安装: ${details['installHint'].trim()}`);
  }

  const text = parts.join('\n---\n').trim();
  return text ? text.slice(0, CHECK_DETAILS_LOG_MAX) : undefined;
}

export function formatChecksForLog(results: CheckResult[]) {
  return results.map((r) => {
    const entry: { id: string; decision: string; message: string; details?: string; controlIds?: string[] } = {
      id: r.checkId,
      decision: r.decision,
      message: r.message,
    };
    if (r.controlIds && r.controlIds.length > 0) entry.controlIds = r.controlIds;
    const details = summarizeCheckDetails(r.details);
    if (details) entry.details = details;
    return entry;
  });
}

export function logGateResult(
  hookName: string,
  gateResult: { passed: boolean; results: CheckResult[]; decision?: { reason?: string }; timing?: GateTiming },
  extra: Record<string, unknown> = {},
): void {
  const cwd = typeof extra['cwd'] === 'string' ? extra['cwd'] : process.cwd();
  const commitSha = getRepoHeadSha(cwd);
  const payload: Record<string, unknown> = {
    level: gateResult.passed ? 'PASSED' : 'BLOCKED',
    checks: formatChecksForLog(gateResult.results),
    ...(gateResult.timing ? { timing: gateResult.timing } : {}),
    ...(commitSha ? { commitSha } : {}),
    ...extra,
  };
  if (!gateResult.passed && gateResult.decision?.reason) {
    payload['reason'] = gateResult.decision.reason.slice(0, 500);
  }
  log(hookName, payload);
}

const DECISION_ICONS: Record<string, string> = { allow: '✅', deny: '❌', skip: '⏭️', warn: '⚠️' };

export function formatCheckSummaryLine(r: CheckResult) {
  const icon = DECISION_ICONS[r.decision] ?? '📋';
  let line = `${icon} [${r.checkId}] ${r.message}`;
  if (r.decision === DECISION.DENY || r.decision === DECISION.WARN) {
    const details = summarizeCheckDetails(r.details);
    if (details) {
      const indented = details
        .split('\n')
        .slice(0, 12)
        .map((l) => `   ${l}`)
        .join('\n');
      line += `\n${indented}`;
    }
  }
  return line;
}

export function summarizeResults(results: CheckResult[]) {
  return results.map(formatCheckSummaryLine).join('\n');
}

export function formatTimingSummary(timing: GateTiming): string {
  if (timing.perCheck.length === 0) return '⏱️ 无可统计的检查耗时';
  const slowest = timing.slowest ? `${timing.slowest.checkId} ${String(timing.slowest.ms)}ms` : 'N/A';
  return [
    `⏱️ 检查耗时: 最高 ${String(timing.maxMs)}ms (${slowest}) | 平均 ${String(timing.avgMs)}ms | 计入 ${String(timing.perCheck.length)} 项`,
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const gateResult = await runQualityGate(options);

  log('quality-gate', {
    level: gateResult.passed ? 'PASSED' : 'BLOCKED',
    profile: options.profile,
    cwd: options.cwd,
    ...(gateResult.passed ? {} : { reason: gateResult.decision.reason?.slice(0, 500) }),
    checks: formatChecksForLog(gateResult.results),
    timing: gateResult.timing,
  });

  if (options.json) {
    console.log(JSON.stringify(gateResult, null, 2));
  } else {
    console.log(summarizeResults(gateResult.results));
    console.log(formatTimingSummary(gateResult.timing));
  }

  if (gateResult.passed && options.profile === 'full') {
    const indexTree = getIndexTreeSha(options.cwd);
    if (indexTree) {
      recordFullPass(options.cwd, indexTree);
    }
  }

  process.exit(gateResult.passed ? 0 : 1);
}

const isDirectRun = import.meta.main;
if (isDirectRun) {
  void main();
}
