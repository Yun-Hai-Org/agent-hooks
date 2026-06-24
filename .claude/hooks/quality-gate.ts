#!/usr/bin/env bun
/**
 * Quality Gate - 共享质量检查 CLI
 * profiles: commit | full
 */

import { decide, formatResult, log, DECISION } from './security-orchestrator.js';
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
import { runSemgrep, runKnip, runTrivy, runGitleaks, runGitleaksStaged } from './checks/security-scan.js';
import { runLintFull } from './checks/lint-full.js';
import { runLintStaged } from './checks/lint-staged.js';
import { runFormatFull } from './checks/format-full.js';
import { runFormatStaged } from './checks/format-staged.js';
import { runCoverage } from './checks/coverage.js';
import { runCodeReview } from './checks/code-review.js';
import { runExtendedLintStaged, runExtendedLintFull } from './checks/extended-lint.js';
import { runSchemaLintStaged, runSchemaLintFull } from './checks/schema-lint.js';
import { runK8sLintStaged, runK8sLintFull } from './checks/k8s-lint.js';
import { runOpenApiContractStaged, runOpenApiContractFull } from './checks/openapi-contract.js';

import type { QualityGateParseOptions, CheckResult, QualityGateResult } from './types.js';

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

export async function runQualityGate(
  options: Pick<QualityGateParseOptions, 'profile' | 'cwd'> & {
    commitCmd?: string;
    commitMsgFile?: string;
  },
): Promise<QualityGateResult> {
  const { profile, cwd, commitCmd, commitMsgFile } = options;

  if (profile === 'commit') {
    const syncResults = [
      checkBranch(cwd),
      commitMsgFile
        ? checkCommitMessageFromFile(commitMsgFile)
        : commitCmd
          ? checkCommitMessage(commitCmd)
          : formatResult('commit-msg', DECISION.SKIP, '无 commit message'),
      checkSensitiveStagedFiles(cwd),
    ];
    const syncDecision = decide(syncResults);
    if (syncDecision.decision === DECISION.DENY) {
      return { passed: false, results: syncResults, decision: syncDecision };
    }

    const [
      auditResult,
      typeResult,
      testResult,
      lintStaged,
      formatStaged,
      gitleaksStaged,
      codeReview,
      hookAdv,
      extendedLint,
      schemaLint,
      k8sLint,
      openApiContract,
    ] = await Promise.all([
      runDepAudit(cwd, { staged: true }),
      runStagedTypecheck(cwd),
      runRelatedTests(cwd),
      runLintStaged(cwd),
      runFormatStaged(cwd),
      runGitleaksStaged(cwd),
      Promise.resolve(runCodeReview(cwd, { staged: true })),
      runHookAdversarialIfStaged(cwd),
      runExtendedLintStaged(cwd),
      runSchemaLintStaged(cwd),
      runK8sLintStaged(cwd),
      runOpenApiContractStaged(cwd),
    ]);
    const results = [
      ...syncResults,
      auditResult,
      typeResult,
      testResult,
      lintStaged,
      formatStaged,
      gitleaksStaged,
      codeReview,
      hookAdv,
      extendedLint,
      schemaLint,
      k8sLint,
      openApiContract,
    ];
    const finalDecision = decide(results);
    return { passed: finalDecision.decision !== DECISION.DENY, results, decision: finalDecision };
  }

  const [
    typeResult,
    lintResult,
    fullTests,
    hookUnit,
    hookAdv,
    depAudit,
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
    openApiContract,
  ] = await Promise.all([
    runFullTypecheck(cwd),
    runLintFull(cwd),
    runFullProjectTests(cwd),
    runHookUnitTests(cwd),
    runHookAdversarialTests(cwd),
    runDepAudit(cwd, { staged: false }),
    runGitleaks(cwd),
    runSemgrep(cwd),
    runKnip(cwd),
    runTrivy(cwd),
    runFormatFull(cwd),
    Promise.resolve(runCoverage(cwd)),
    Promise.resolve(runCodeReview(cwd)),
    runExtendedLintFull(cwd),
    runSchemaLintFull(cwd),
    runK8sLintFull(cwd),
    runOpenApiContractFull(cwd),
  ]);

  const results = [
    typeResult,
    lintResult,
    fullTests,
    hookUnit,
    hookAdv,
    depAudit,
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
    openApiContract,
  ];
  const finalDecision = decide(results);
  return { passed: finalDecision.decision !== DECISION.DENY, results, decision: finalDecision };
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
    const entry: { id: string; decision: string; message: string; details?: string } = {
      id: r.checkId,
      decision: r.decision,
      message: r.message,
    };
    const details = summarizeCheckDetails(r.details);
    if (details) entry.details = details;
    return entry;
  });
}

export function logGateResult(
  hookName: string,
  gateResult: { passed: boolean; results: CheckResult[]; decision?: { reason?: string } },
  extra: Record<string, unknown> = {},
): void {
  const payload: Record<string, unknown> = {
    level: gateResult.passed ? 'PASSED' : 'BLOCKED',
    checks: formatChecksForLog(gateResult.results),
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const gateResult = await runQualityGate(options);

  log('quality-gate', {
    level: gateResult.passed ? 'PASSED' : 'BLOCKED',
    profile: options.profile,
    cwd: options.cwd,
    ...(gateResult.passed ? {} : { reason: gateResult.decision.reason?.slice(0, 500) }),
    checks: formatChecksForLog(gateResult.results),
  });

  if (options.json) {
    console.log(JSON.stringify(gateResult, null, 2));
  } else {
    console.log(summarizeResults(gateResult.results));
  }

  process.exit(gateResult.passed ? 0 : 1);
}

const isDirectRun = import.meta.main;
if (isDirectRun) {
  void main();
}
