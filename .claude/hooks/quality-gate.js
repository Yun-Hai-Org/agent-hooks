#!/usr/bin/env bun
/**
 * Quality Gate - 共享质量检查 CLI
 * profiles: commit | full
 */

import { decide, formatResult, log, DECISION } from './security-orchestrator.js';
import {
  checkBranch,
  checkCommitMessage,
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

/** @typedef {'commit' | 'full'} QualityProfile */

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{ profile: QualityProfile; cwd: string; json: boolean; commitCmd?: string }} */
  const options = { profile: 'full', cwd: process.cwd(), json: false };
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
    }
  }
  return options;
}

/**
 * @param {{ profile: QualityProfile; cwd: string; commitCmd?: string }} options
 */
export async function runQualityGate(options) {
  const { profile, cwd, commitCmd } = options;

  if (profile === 'commit') {
    const syncResults = [
      checkBranch(cwd),
      commitCmd ? checkCommitMessage(commitCmd) : formatResult('commit-msg', DECISION.SKIP, '无 commit message'),
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
    ] = await Promise.all([
      runDepAudit(cwd, { staged: true }),
      runStagedTypecheck(cwd),
      runRelatedTests(cwd),
      runLintStaged(cwd),
      runFormatStaged(cwd),
      runGitleaksStaged(cwd),
      runCodeReview(cwd, { staged: true }),
      runHookAdversarialIfStaged(cwd),
      runExtendedLintStaged(cwd),
      runSchemaLintStaged(cwd),
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
    runCoverage(cwd),
    runCodeReview(cwd),
    runExtendedLintFull(cwd),
    runSchemaLintFull(cwd),
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
  ];
  const finalDecision = decide(results);
  return { passed: finalDecision.decision !== DECISION.DENY, results, decision: finalDecision };
}

export const CHECK_DETAILS_LOG_MAX = 2000;

/** @param {Record<string, unknown> | undefined} details */
export function summarizeCheckDetails(details) {
  if (!details || typeof details !== 'object') return undefined;

  const parts = [];
  if (typeof details.output === 'string' && details.output.trim()) {
    parts.push(details.output.trim());
  }
  if (Array.isArray(details.failures)) {
    for (const failure of details.failures) {
      if (!failure || typeof failure !== 'object') continue;
      const f = /** @type {{ tool?: string; stdout?: string; stderr?: string }} */ (failure);
      const text = [f.stderr, f.stdout].filter((s) => typeof s === 'string' && s.trim()).join('\n').trim();
      parts.push(text ? `${f.tool ?? 'tool'}:\n${text}` : `${f.tool ?? 'tool'}: failed`);
    }
  }
  if (Array.isArray(details.findings) && details.findings.length > 0) {
    parts.push(JSON.stringify(details.findings));
  }
  if (Array.isArray(details.matched) && details.matched.length > 0) {
    parts.push(`matched: ${details.matched.join(', ')}`);
  }
  if (typeof details.installHint === 'string' && details.installHint.trim()) {
    parts.push(`安装: ${details.installHint.trim()}`);
  }

  const text = parts.join('\n---\n').trim();
  return text ? text.slice(0, CHECK_DETAILS_LOG_MAX) : undefined;
}

/** @param {Array<{ checkId: string; decision: string; message: string; details?: Record<string, unknown> }>} results */
export function formatChecksForLog(results) {
  return results.map((r) => {
    /** @type {{ id: string; decision: string; message: string; details?: string }} */
    const entry = { id: r.checkId, decision: r.decision, message: r.message };
    const details = summarizeCheckDetails(r.details);
    if (details) entry.details = details;
    return entry;
  });
}

/**
 * @param {string} hookName
 * @param {{ passed: boolean; results: Array<{ checkId: string; decision: string; message: string; details?: Record<string, unknown> }>; decision?: { reason?: string } }} gateResult
 * @param {Record<string, unknown>} [extra]
 */
export function logGateResult(hookName, gateResult, extra = {}) {
  /** @type {Record<string, unknown>} */
  const payload = {
    level: gateResult.passed ? 'PASSED' : 'BLOCKED',
    checks: formatChecksForLog(gateResult.results),
    ...extra,
  };
  if (!gateResult.passed && gateResult.decision?.reason) {
    payload.reason = gateResult.decision.reason.slice(0, 500);
  }
  log(hookName, payload);
}

/** @param {{ checkId: string; decision: string; message: string; details?: Record<string, unknown> }} r */
export function formatCheckSummaryLine(r) {
  const icon = { allow: '✅', deny: '❌', skip: '⏭️', warn: '⚠️' }[r.decision] || '📋';
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

/** @param {any[]} results */
export function summarizeResults(results) {
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
  main();
}
