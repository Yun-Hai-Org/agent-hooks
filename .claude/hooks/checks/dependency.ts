import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { execCommandAsync, formatResult, withTimeout, DECISION, getHookProcessEnv } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { denyIfToolMissing, denyOnToolError, getBunAuditInvocation } from './tools.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const DEP_AUDIT_TIMEOUT_MS = 30000;
const DEP_AUDIT_TRIGGER_FILES = ['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'] as const;

/** audit 走 npmjs.org；install 仍可用 ~/.npmrc 镜像 */
export const NPM_AUDIT_REGISTRY = 'https://registry.npmjs.org';

const SEVERITY_KEYS = ['critical', 'high', 'moderate', 'low', 'info'] as const;

export function getDepAuditProcessEnv(): NodeJS.ProcessEnv {
  return getHookProcessEnv({ NPM_CONFIG_REGISTRY: NPM_AUDIT_REGISTRY });
}

export function extractAuditJsonText(stdout: string, stderr: string): string | null {
  const trimmedStdout = stdout.trim();
  if (trimmedStdout.startsWith('{')) {
    return trimmedStdout;
  }

  for (const text of [stderr, stdout]) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    const candidate = text.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // try next source
    }
  }

  return null;
}

export function aggregateAdvisorySeverities(payload: unknown): Record<string, number> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const counts: Record<string, number> = Object.fromEntries(SEVERITY_KEYS.map((k) => [k, 0]));
  let found = false;

  for (const value of Object.values(payload)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const severity = (item as { severity?: string }).severity;
      if (typeof severity === 'string' && severity in counts) {
        counts[severity] = (counts[severity] ?? 0) + 1;
        found = true;
      }
    }
  }

  return found ? counts : null;
}

export function parseBunAuditSeverities(stdout: string, stderr = ''): Record<string, number> | null {
  const jsonText = extractAuditJsonText(stdout, stderr);
  if (!jsonText) return null;

  try {
    const json = JSON.parse(jsonText) as {
      metadata?: { vulnerabilities?: Record<string, number> };
      [key: string]: unknown;
    };

    if (json.metadata?.vulnerabilities) {
      return json.metadata.vulnerabilities;
    }

    const aggregated = aggregateAdvisorySeverities(json);
    if (aggregated) return aggregated;

    if (Object.keys(json).length === 0) {
      return {};
    }

    return null;
  } catch {
    return null;
  }
}

export function mergeSeverityCounts(...lists: Record<string, number>[]): Record<string, number> {
  const merged: Record<string, number> = Object.fromEntries(SEVERITY_KEYS.map((k) => [k, 0]));
  for (const counts of lists) {
    for (const [key, val] of Object.entries(counts)) {
      merged[key] = (merged[key] ?? 0) + val;
    }
  }
  return merged;
}

export function resolveJsDepAuditCwd(cwd: string, stagedFiles?: string[]): string[] {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根
  if (existsSync(join(cwd, 'package.json'))) {
    return [cwd];
  }
  if (!stagedFiles?.length) return [];

  const repoRoot = cwd;
  const roots = new Set<string>();

  for (const file of stagedFiles) {
    if (!DEP_AUDIT_TRIGGER_FILES.some((t) => file.endsWith(t))) continue;

    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- file 来自 git 暂存区路径
    let dir = dirname(file.startsWith('/') ? file : join(cwd, file));
    for (let depth = 0; depth < 20; depth++) {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- dir 派生自受信暂存路径
      if (existsSync(join(dir, 'package.json'))) {
        roots.add(dir);
        break;
      }
      if (dir === repoRoot) break;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return [...roots];
}

export function isRegistryAuditFailure(stdout: string, stderr: string): boolean {
  return /audit request failed \(status \d+\)/i.test(`${stdout}\n${stderr}`);
}

export function registryAuditFailureMessage(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`;
  const match = /audit request failed \(status (\d+)\)/i.exec(combined);
  const status = match?.[1] ?? 'unknown';
  return `audit registry 不可用 (status ${status})，请检查网络或联系管理员`;
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

async function runBunAuditAt(
  auditCwd: string,
  auditCmd: string,
  timeoutMs: number = DEP_AUDIT_TIMEOUT_MS,
): Promise<{
  severities: Record<string, number> | null;
  registryError: boolean;
  stdout: string;
  stderr: string;
}> {
  const result = await withTimeout(
    execCommandAsync(auditCmd, {
      cwd: auditCwd,
      timeout: timeoutMs,
      env: getDepAuditProcessEnv(),
    }),
    timeoutMs,
    `bun audit 超时 (${String(timeoutMs / 1000)}s)`,
  );

  if (isRegistryAuditFailure(result.stdout, result.stderr)) {
    return { severities: null, registryError: true, stdout: result.stdout, stderr: result.stderr };
  }

  const severities = parseBunAuditSeverities(result.stdout, result.stderr);
  return { severities, registryError: false, stdout: result.stdout, stderr: result.stderr };
}

export async function runDepAudit(cwd?: string, options: GateCheckRunOptions = {}) {
  const repoCwd = cwd ?? process.cwd();
  const { staged = false } = options;
  const auditTimeoutMs = options.timeoutMs ?? DEP_AUDIT_TIMEOUT_MS;
  let stagedFiles: string[] | undefined;

  if (staged) {
    stagedFiles = getStagedFiles(repoCwd);
    const hasTrigger = stagedFiles.some((f) => DEP_AUDIT_TRIGGER_FILES.some((t) => f.endsWith(t)));
    if (!hasTrigger) {
      return formatResult('dep-audit', DECISION.SKIP, '暂存区无依赖文件变更，跳过审计');
    }
  }

  const auditRoots = resolveJsDepAuditCwd(repoCwd, staged ? stagedFiles : undefined);
  if (staged && auditRoots.length === 0) {
    return formatResult('dep-audit', DECISION.SKIP, '无可用 JS package 根，跳过依赖审计');
  }
  if (!staged && auditRoots.length === 0) {
    return formatResult('dep-audit', DECISION.SKIP, '无 package.json，跳过依赖审计');
  }

  const missing = denyIfToolMissing('bun', 'dep-audit', repoCwd);
  if (missing) return missing;

  const auditCmd = getBunAuditInvocation(repoCwd);
  if (!auditCmd) {
    return formatResult(
      'dep-audit',
      DECISION.DENY,
      'bun >= 1.2.15 才支持 audit。请运行: ./scripts/install-vendored-bun.sh',
      { installHint: './scripts/install-vendored-bun.sh' },
    );
  }

  try {
    const severityLists: Record<string, number>[] = [];

    for (const auditCwd of auditRoots) {
      const { severities, registryError, stdout, stderr } = await runBunAuditAt(auditCwd, auditCmd, auditTimeoutMs);
      const output = (stderr || stdout).slice(0, 300);
      if (registryError) {
        return formatResult('dep-audit', DECISION.DENY, registryAuditFailureMessage(stdout, stderr), { output });
      }
      if (severities === null) {
        return formatResult('dep-audit', DECISION.DENY, '依赖审计输出不可解析，按失败处理（fail-closed）', {
          output,
        });
      }
      severityLists.push(severities);
    }

    return evaluateBunAudit(mergeSeverityCounts(...severityLists));
  } catch (e) {
    return denyOnToolError(e, 'dep-audit', 'bun audit');
  }
}
