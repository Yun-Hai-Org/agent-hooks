import { execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import type { CheckResult } from '../types.js';

const DEP_AUDIT_TIMEOUT_MS = 30000;

export function parseBunAuditSeverities(stdout: string): Record<string, number> | null {
  try {
    const json = JSON.parse(stdout) as { metadata?: { vulnerabilities?: Record<string, number> } };
    return json.metadata?.vulnerabilities ?? null;
  } catch {
    return null;
  }
}

export function evaluateBunAudit(severities: Record<string, number>): CheckResult {
  const critical = severities['critical'] ?? 0;
  const high = severities['high'] ?? 0;
  const moderate = severities['moderate'] ?? 0;
  if (critical + high + moderate > 0) {
    return formatResult(
      'dep-audit',
      DECISION.DENY,
      `依赖审计发现 ${String(critical)} critical, ${String(high)} high, ${String(moderate)} moderate 漏洞`,
      { vulnerabilities: severities },
    );
  }
  return formatResult('dep-audit', DECISION.ALLOW, '依赖审计通过（无 moderate+ 漏洞）');
}

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
      execCommandAsync('bun audit --json', { cwd, timeout: DEP_AUDIT_TIMEOUT_MS }),
      DEP_AUDIT_TIMEOUT_MS,
      `bun audit 超时 (${String(DEP_AUDIT_TIMEOUT_MS / 1000)}s)`,
    );
    const severities = parseBunAuditSeverities(result.stdout);
    if (severities === null) {
      return formatResult('dep-audit', DECISION.WARN, '依赖审计无法执行（输出不可解析，可能离线或 registry 不可达）', {
        output: (result.stderr || result.stdout).slice(0, 300),
      });
    }
    return evaluateBunAudit(severities);
  } catch (e) {
    return denyOnToolError(e, 'dep-audit', 'bun audit');
  }
}
