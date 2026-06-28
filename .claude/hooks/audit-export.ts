import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getRepoHeadSha } from './security-orchestrator.js';
import { formatChecksForLog } from './quality-gate.js';
import type { CheckResult, GateTiming } from './types.js';

const AUDIT_DIR = '.hooks/audit';

export interface AuditExportInput {
  hookName: string;
  cwd: string;
  passed: boolean;
  results: CheckResult[];
  timing?: GateTiming;
  gatePathPrefix?: string;
}

export function exportAuditRecord(input: AuditExportInput): string | null {
  const sha = getRepoHeadSha(input.cwd, true) ?? 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，AUDIT_DIR 为常量
  const outDir = join(input.cwd, AUDIT_DIR);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- outDir 派生自受信 root 与常量目录
  const outFile = join(outDir, `${date}-${sha}.jsonl`);
  const entry = {
    ts: new Date().toISOString(),
    hook: input.hookName,
    commitSha: sha,
    gatePathPrefix: input.gatePathPrefix,
    level: input.passed ? 'PASSED' : 'BLOCKED',
    checks: formatChecksForLog(input.results),
    ...(input.timing ? { timing: input.timing } : {}),
  };
  appendFileSync(outFile, JSON.stringify(entry) + '\n', 'utf-8');
  return outFile;
}
