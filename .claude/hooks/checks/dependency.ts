import { execCommand, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';

/** @param {string} [cwd] @param {{ staged?: boolean }} [options] */
export async function runDepAudit(cwd?: string, options: { staged?: boolean } = {}) {
  const { staged = false } = options;
  if (staged) {
    const stagedFiles = getStagedFiles(cwd);
    const triggers = ['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock'];
    const hasTrigger = stagedFiles.some((f) => triggers.some((t) => f.endsWith(t)));
    if (!hasTrigger) {
      return formatResult('dep-audit', DECISION.SKIP, '暂存区无依赖文件变更，跳过审计');
    }
  }

  const missing = denyIfToolMissing('bun', 'dep-audit', cwd);
  if (missing) return missing;

  try {
    const result = await withTimeout(
      Promise.resolve(execCommand('bun pm audit --json', { cwd, timeout: 5000 })),
      5000,
      'bun pm audit 超时 (5s)',
    );
    if (result.success) return formatResult('dep-audit', DECISION.ALLOW, '依赖审计通过');
    const output = result.stdout + result.stderr;
    const hasCritical = /critical/i.test(output);
    const hasHigh = /high/i.test(output);
    const hasMedium = /medium/i.test(output);
    const deny = hasCritical || hasHigh || hasMedium;
    if (deny) {
      return formatResult('dep-audit', DECISION.DENY, '依赖审计发现漏洞', { output: output.slice(0, 500) });
    }
    return formatResult('dep-audit', DECISION.ALLOW, '依赖审计通过（无阻断级漏洞）');
  } catch (e) {
    return denyOnToolError(e, 'dep-audit', 'bun pm audit');
  }
}
