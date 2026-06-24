import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing } from './tools.js';

const DEFAULT_THRESHOLD = 0;

/** @param {string} [cwd] @param {{ threshold?: number }} [options] */
export async function runCoverage(cwd?: string, options: { threshold?: number } = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const hasPackageJson = execCommand('test -f package.json', { cwd }).success;

  if (!hasPackageJson) {
    return formatResult('coverage', DECISION.SKIP, '无 package.json，跳过覆盖率');
  }

  const missing = denyIfToolMissing('bun', 'coverage', cwd);
  if (missing) return missing;

  if (execCommand('grep -q coverage package.json', { cwd }).success) {
    const result = execCommand('bun test --coverage 2>&1 | tail -5', { cwd, timeout: 120000 });
    if (!result.success) {
      return formatResult('coverage', DECISION.DENY, '覆盖率测试失败', {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }
    const match = (result.stdout + result.stderr).match(/(\d+(?:\.\d+)?)\s*%/);
    const pct = match?.[1] ? parseFloat(match[1]) : 100;
    if (pct < threshold) {
      return formatResult('coverage', DECISION.DENY, `覆盖率 ${pct}% 低于阈值 ${threshold}%`);
    }
    return formatResult('coverage', DECISION.ALLOW, `覆盖率 ${pct}% 达标`);
  }

  return formatResult('coverage', DECISION.SKIP, '未配置覆盖率脚本，跳过');
}
