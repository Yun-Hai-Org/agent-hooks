import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import type { CheckResult } from '../types.js';

function hasPythonDependencies(cwd?: string): boolean {
  if (!execCommand('test -f pyproject.toml', { cwd }).success) return false;
  const result = execCommand('grep -E "^dependencies\\s*=\\s*\\[" pyproject.toml -A5', { cwd, timeout: 5000 });
  if (!result.success) return false;
  const block = result.stdout.trim();
  if (/dependencies\s*=\s*\[\s*\]/.test(block.replace(/\n/g, ' '))) return false;
  return /\[\s*"[^"]+"/.test(block) || /\[\s*'[^']+'/.test(block);
}

function parseOsvScannerOutput(output: string): boolean {
  const hasCritical = /"severity"\s*:\s*"CRITICAL"/i.test(output);
  const hasHigh = /"severity"\s*:\s*"HIGH"/i.test(output);
  const hasMedium = /"severity"\s*:\s*"MEDIUM"/i.test(output);
  return hasCritical || hasHigh || hasMedium;
}

function parsePipAuditOutput(output: string): boolean {
  const hasCritical = /\bcritical\b/i.test(output);
  const hasHigh = /\bhigh\b/i.test(output);
  const hasMedium = /\bmedium\b/i.test(output);
  return hasCritical || hasHigh || hasMedium;
}

export async function runPyDepAudit(cwd?: string): Promise<CheckResult> {
  const hasPyproject = execCommand('test -f pyproject.toml', { cwd }).success;
  if (!hasPyproject) {
    return formatResult('py-dep-audit', DECISION.SKIP, '无 pyproject.toml，跳过 Python 依赖审计');
  }

  if (!hasPythonDependencies(cwd)) {
    return formatResult('py-dep-audit', DECISION.SKIP, '无 Python 运行时依赖，跳过审计');
  }

  const hasUvLock = execCommand('test -f uv.lock', { cwd }).success;
  const hasOsv = execCommand('command -v osv-scanner', { cwd }).success;
  const hasPipAudit = execCommand('command -v pip-audit', { cwd }).success;
  const hasUv = execCommand('command -v uv', { cwd }).success;

  if (hasOsv && hasUvLock) {
    try {
      const result = await withTimeout(
        execCommandAsync('osv-scanner --lockfile=uv.lock --format json', { cwd, timeout: 60000 }),
        60000,
        'osv-scanner 超时 (60s)',
      );
      const output = result.stdout + result.stderr;
      if (!result.success || parseOsvScannerOutput(output)) {
        return formatResult('py-dep-audit', DECISION.DENY, 'Python 依赖审计发现漏洞 (osv-scanner)', {
          output: output.slice(0, 500),
        });
      }
      return formatResult('py-dep-audit', DECISION.ALLOW, 'Python 依赖审计通过 (osv-scanner)');
    } catch (e) {
      return denyOnToolError(e, 'py-dep-audit', 'osv-scanner');
    }
  }

  if (hasPipAudit || hasUv) {
    const missing = denyIfToolMissing(hasUv ? 'uv' : 'pip-audit', 'py-dep-audit', cwd);
    if (missing) return missing;
    const cmd = hasUv ? 'uv run pip-audit' : 'pip-audit';
    try {
      const result = await withTimeout(execCommandAsync(cmd, { cwd, timeout: 60000 }), 60000, 'pip-audit 超时 (60s)');
      const output = result.stdout + result.stderr;
      if (!result.success || parsePipAuditOutput(output)) {
        return formatResult('py-dep-audit', DECISION.DENY, 'Python 依赖审计发现漏洞 (pip-audit)', {
          output: output.slice(0, 500),
        });
      }
      return formatResult('py-dep-audit', DECISION.ALLOW, 'Python 依赖审计通过 (pip-audit)');
    } catch (e) {
      return denyOnToolError(e, 'py-dep-audit', 'pip-audit');
    }
  }

  const missing = denyIfToolMissing('osv-scanner', 'py-dep-audit', cwd);
  return missing ?? formatResult('py-dep-audit', DECISION.DENY, 'Python 依赖审计工具未安装');
}
