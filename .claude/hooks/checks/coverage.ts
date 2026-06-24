import { execCommand, formatResult, DECISION, TESTS_DIR } from '../security-orchestrator.js';
import { denyIfToolMissing } from './tools.js';
import type { CheckResult } from '../types.js';

/**
 * 实测全量 hook 单测行覆盖约 52.7%（2026-06，已 ratchet 至实测下限 52）。
 * 阈值只升不降；下一里程碑 60%，需对 lint-full/format-full/tests/typecheck/merge-gate
 * 等子进程密集模块补针对性单测后再上调。
 */
export const DEFAULT_COVERAGE_THRESHOLD = 52;

/** 业务代码（非 hook）测试的行覆盖率下限，仅在存在项目级测试时强制 */
export const BUSINESS_COVERAGE_THRESHOLD = 50;

export function parseCoveragePercent(output: string): number | null {
  const allFilesMatch = /All files[^|\n]*\|\s*\d+(?:\.\d+)?\s*\|\s*(\d+(?:\.\d+)?)/i.exec(output);
  if (allFilesMatch?.[1]) {
    const pct = parseFloat(allFilesMatch[1]);
    return Number.isFinite(pct) ? pct : null;
  }
  const fallbackMatch = /(\d+(?:\.\d+)?)\s*%\s*\|/.exec(output);
  if (fallbackMatch?.[1]) {
    const pct = parseFloat(fallbackMatch[1]);
    return Number.isFinite(pct) ? pct : null;
  }
  return null;
}

export function runCoverage(cwd?: string, options: { threshold?: number } = {}): CheckResult {
  const threshold = options.threshold ?? DEFAULT_COVERAGE_THRESHOLD;
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

  const pct = parseCoveragePercent(output);

  if (pct === null || pct < threshold) {
    return formatResult(
      'coverage',
      DECISION.DENY,
      pct === null
        ? `无法解析覆盖率，要求 >= ${String(threshold)}%`
        : `覆盖率 ${String(pct)}% 低于阈值 ${String(threshold)}%`,
      { output: output.slice(0, 500) },
    );
  }

  return formatResult('coverage', DECISION.ALLOW, `覆盖率 ${String(pct)}% 达标 (阈值 ${String(threshold)}%)`);
}
