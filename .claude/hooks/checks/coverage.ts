import { execCommand, formatResult, DECISION, TESTS_DIR } from '../security-orchestrator.js';
import { denyIfToolMissing } from './tools.js';
import type { CheckResult } from '../types.js';

const DEFAULT_THRESHOLD = 80;

export function runCoverage(cwd?: string, options: { threshold?: number } = {}): CheckResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
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
  const result = execCommand(`bun test ${files} --coverage 2>&1`, { cwd, timeout: 120000 });
  const output = result.stdout + result.stderr;

  if (!result.success) {
    return formatResult('coverage', DECISION.DENY, '覆盖率测试失败', { output: output.slice(0, 500) });
  }

  const lineMatch = /All files[^\n]*\|\s*([\d.]+)/i.exec(output) ?? /(\d+(?:\.\d+)?)\s*%\s*\|/.exec(output);
  const pct = lineMatch?.[1] ? parseFloat(lineMatch[1]) : threshold;

  if (pct < threshold) {
    return formatResult('coverage', DECISION.DENY, `覆盖率 ${String(pct)}% 低于阈值 ${String(threshold)}%`, {
      output: output.slice(0, 500),
    });
  }

  return formatResult('coverage', DECISION.ALLOW, `覆盖率 ${String(pct)}% 达标 (阈值 ${String(threshold)}%)`);
}
