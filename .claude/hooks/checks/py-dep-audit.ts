import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

function hasPythonDependencies(cwd?: string): boolean {
  if (!execCommand('test -f pyproject.toml', { cwd }).success) return false;
  const result = execCommand('grep -E "^dependencies\\s*=\\s*\\[" pyproject.toml -A5', { cwd, timeout: 5000 });
  if (!result.success) return false;
  const block = result.stdout.trim();
  if (/dependencies\s*=\s*\[\s*\]/.test(block.replace(/\n/g, ' '))) return false;
  return /\[\s*"[^"]+"/.test(block) || /\[\s*'[^']+'/.test(block);
}

interface OsvJson {
  results?: { packages?: { vulnerabilities?: unknown[] }[] }[];
}

interface PipAuditDep {
  vulns?: unknown[];
}

/** 解析 osv-scanner --format json：任一包含 vulnerabilities 即判定有漏洞；无法解析返回 null（fail-closed）。 */
export function osvHasVulnerabilities(stdout: string): boolean | null {
  let json: OsvJson;
  try {
    json = JSON.parse(stdout) as OsvJson;
  } catch {
    return null;
  }
  for (const result of json.results ?? []) {
    for (const pkg of result.packages ?? []) {
      if ((pkg.vulnerabilities?.length ?? 0) > 0) return true;
    }
  }
  return false;
}

/** 解析 pip-audit --format json（兼容 {dependencies:[...]} 与裸数组两种结构）；无法解析返回 null。 */
export function pipAuditHasVulnerabilities(stdout: string): boolean | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const deps: PipAuditDep[] = Array.isArray(parsed)
    ? (parsed as PipAuditDep[])
    : ((parsed as { dependencies?: PipAuditDep[] }).dependencies ?? []);
  return deps.some((d) => (d.vulns?.length ?? 0) > 0);
}

export async function runPyDepAudit(cwd?: string, _options?: GateCheckRunOptions): Promise<CheckResult> {
  void _options;
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
      const has = osvHasVulnerabilities(result.stdout);
      if (has === null) {
        return formatResult('py-dep-audit', DECISION.DENY, 'osv-scanner 输出不可解析，按失败处理（fail-closed）', {
          output: (result.stderr || result.stdout).slice(0, 500),
        });
      }
      if (has) {
        return formatResult('py-dep-audit', DECISION.DENY, 'Python 依赖审计发现漏洞 (osv-scanner)', {
          output: result.stdout.slice(0, 500),
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
    const cmd = hasUv ? 'uv run pip-audit --format json' : 'pip-audit --format json';
    try {
      const result = await withTimeout(execCommandAsync(cmd, { cwd, timeout: 60000 }), 60000, 'pip-audit 超时 (60s)');
      const has = pipAuditHasVulnerabilities(result.stdout);
      if (has === null) {
        return formatResult('py-dep-audit', DECISION.DENY, 'pip-audit 输出不可解析，按失败处理（fail-closed）', {
          output: (result.stderr || result.stdout).slice(0, 500),
        });
      }
      if (has) {
        return formatResult('py-dep-audit', DECISION.DENY, 'Python 依赖审计发现漏洞 (pip-audit)', {
          output: result.stdout.slice(0, 500),
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
