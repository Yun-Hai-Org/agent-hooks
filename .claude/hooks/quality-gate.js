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
} from './checks/tests.js';
import { runSemgrep, runKnip, runTrivy, runGitleaks } from './checks/security-scan.js';
import { runLintFull } from './checks/lint-full.js';
import { runFormatFull } from './checks/format-full.js';
import { runCoverage } from './checks/coverage.js';
import { runCodeReview } from './checks/code-review.js';

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

    const [auditResult, typeResult, testResult] = await Promise.all([
      runDepAudit(cwd, { staged: true }),
      runStagedTypecheck(cwd),
      runRelatedTests(cwd),
    ]);
    const results = [...syncResults, auditResult, typeResult, testResult];
    const finalDecision = decide(results);
    return { passed: finalDecision.decision !== DECISION.DENY, results, decision: finalDecision };
  }

  const [typeResult, lintResult, fullTests, hookUnit, hookAdv, depAudit, gitleaks, semgrep, knip, trivy, formatResult_, coverageResult, reviewResult] =
    await Promise.all([
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
  ];
  const finalDecision = decide(results);
  return { passed: finalDecision.decision !== DECISION.DENY, results, decision: finalDecision };
}

/** @param {any[]} results */
export function summarizeResults(results) {
  return results
    .map((r) => {
      const icon = { allow: '✅', deny: '❌', skip: '⏭️', warn: '⚠️' }[r.decision] || '📋';
      return `${icon} [${r.checkId}] ${r.message}`;
    })
    .join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const gateResult = await runQualityGate(options);

  log('quality-gate', {
    level: gateResult.passed ? 'PASSED' : 'BLOCKED',
    profile: options.profile,
    cwd: options.cwd,
    checks: gateResult.results.map((r) => ({ id: r.checkId, decision: r.decision })),
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
