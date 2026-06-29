import { execCommand, formatResult, DECISION, TESTS_DIR } from '../security-orchestrator.js';
import { denyIfToolMissing } from './tools.js';
import type { CoverageThresholdOptions, CheckResult } from '../types.js';

/** push/merge full 门默认双覆盖率下限（可被 quality-gate.yaml settings 覆盖） */
export const DEFAULT_COVERAGE_THRESHOLDS: CoverageThresholdOptions = { lines: 80, functions: 80 };

export interface CoverageMetrics {
  lines: number | null;
  functions: number | null;
}

export function parseCoverageMetrics(output: string): CoverageMetrics {
  const allFilesMatch = /All files[^|\n]*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)/i.exec(output);
  if (allFilesMatch?.[1] && allFilesMatch[2]) {
    const functions = parseFloat(allFilesMatch[1]);
    const lines = parseFloat(allFilesMatch[2]);
    return {
      functions: Number.isFinite(functions) ? functions : null,
      lines: Number.isFinite(lines) ? lines : null,
    };
  }
  const lineOnlyMatch = /All files[^|\n]*\|\s*(\d+(?:\.\d+)?)\s*\|/i.exec(output);
  if (lineOnlyMatch?.[1]) {
    const lines = parseFloat(lineOnlyMatch[1]);
    return { lines: Number.isFinite(lines) ? lines : null, functions: null };
  }
  return { lines: null, functions: null };
}

/** @deprecated 使用 parseCoverageMetrics；保留 lines 别名 */
export function parseCoveragePercent(output: string): number | null {
  return parseCoverageMetrics(output).lines;
}

export function evaluateCoverageAgainstThresholds(
  metrics: CoverageMetrics,
  thresholds: CoverageThresholdOptions,
): { pass: boolean; message: string } {
  const failures: string[] = [];
  if (metrics.lines === null) {
    failures.push('无法解析 Lines 覆盖率');
  } else if (metrics.lines < thresholds.lines) {
    failures.push(`Lines ${String(metrics.lines)}% < ${String(thresholds.lines)}%`);
  }
  if (metrics.functions === null) {
    failures.push('无法解析 Funcs 覆盖率');
  } else if (metrics.functions < thresholds.functions) {
    failures.push(`Funcs ${String(metrics.functions)}% < ${String(thresholds.functions)}%`);
  }
  if (failures.length === 0) {
    return {
      pass: true,
      message: `覆盖率 Lines ${String(metrics.lines)}% / Funcs ${String(metrics.functions)}% 达标 (阈值 Lines ${String(thresholds.lines)}% / Funcs ${String(thresholds.functions)}%)`,
    };
  }
  return { pass: false, message: `Hook 单测通过但覆盖率未达标：${failures.join('；')}` };
}

export function runCoverage(cwd?: string, options: { thresholds?: CoverageThresholdOptions } = {}): CheckResult {
  const thresholds = options.thresholds ?? DEFAULT_COVERAGE_THRESHOLDS;
  const hasPackageJson = execCommand('test -f package.json', { cwd }).success;

  if (!hasPackageJson) {
    return formatResult('coverage', DECISION.SKIP, '无 package.json，跳过覆盖率');
  }

  const missing = denyIfToolMissing('bun', 'coverage', cwd);
  if (missing) return missing;

  if (!execCommand(`test -d "${TESTS_DIR}"`, { cwd }).success) {
    return formatResult('coverage', DECISION.SKIP, '无 Hook 测试目录，跳过覆盖率');
  }

  const testList = execCommand('find .claude/hooks/__tests__ -maxdepth 1 -name "*.test.ts"', { cwd, timeout: 5000 });
  const testFiles = testList.success ? testList.stdout.trim().split('\n').filter(Boolean) : [];
  if (testFiles.length === 0) {
    return formatResult('coverage', DECISION.SKIP, '无 Hook 单测文件，跳过覆盖率');
  }

  const files = testFiles.map((f) => `"./${f}"`).join(' ');
  const result = execCommand(`bun test ${files} --coverage --dots 2>&1`, { cwd, timeout: 120000 });
  const output = result.stdout + result.stderr;

  if (!result.success) {
    return formatResult('coverage', DECISION.DENY, '覆盖率测试失败', { output: output.slice(0, 500) });
  }

  const metrics = parseCoverageMetrics(output);
  const evaluation = evaluateCoverageAgainstThresholds(metrics, thresholds);

  if (!evaluation.pass) {
    return formatResult('coverage', DECISION.DENY, evaluation.message, { output: output.slice(0, 500) });
  }

  return formatResult('coverage', DECISION.ALLOW, evaluation.message);
}
