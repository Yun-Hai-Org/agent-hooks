import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getRepoHeadSha, DECISION } from './security-orchestrator.js';
import { formatChecksForLog } from './quality-gate.js';
import type { CheckResult, GateTiming } from './types.js';

const AUDIT_DIR = '.hooks/audit';
const SBOM_DIR = '.hooks/sbom';

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

export function buildSarifFromResults(results: CheckResult[]): Record<string, unknown> {
  const runs = [
    {
      tool: { driver: { name: 'quality-gate', rules: [] as Record<string, unknown>[] } },
      results: [] as Record<string, unknown>[],
    },
  ];
  const driver = runs[0]?.tool.driver;
  if (!driver) return { version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json', runs: [] };

  for (const r of results) {
    if (r.decision !== DECISION.DENY && r.decision !== DECISION.WARN) continue;
    const ruleId = r.checkId;
    driver.rules.push({
      id: ruleId,
      name: ruleId,
      ...(r.controlIds?.length ? { properties: { tags: r.controlIds } } : {}),
    });
    runs[0]?.results.push({
      ruleId,
      level: r.decision === DECISION.DENY ? 'error' : 'warning',
      message: { text: r.message },
    });
  }
  return { version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json', runs };
}

export function exportSarifRecord(input: AuditExportInput): string | null {
  const sha = getRepoHeadSha(input.cwd, true) ?? 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，AUDIT_DIR 为常量
  const outDir = join(input.cwd, AUDIT_DIR);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- outDir 派生自受信 root 与常量目录
  const outFile = join(outDir, `${date}-${sha}.sarif.json`);
  const sarif = buildSarifFromResults(input.results);
  writeFileSync(outFile, JSON.stringify(sarif, null, 2), 'utf-8');
  return outFile;
}

export function appendAuditManifest(input: AuditExportInput, auditPath: string | null, sarifPath: string | null): void {
  const sha = getRepoHeadSha(input.cwd, true) ?? 'unknown';
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，AUDIT_DIR 为常量
  const outDir = join(input.cwd, AUDIT_DIR);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，SBOM_DIR 为常量
  const sbomLatest = join(input.cwd, SBOM_DIR, 'latest.json');
  const controlIds = [...new Set(input.results.flatMap((r) => r.controlIds ?? []).filter(Boolean))];
  const entry = {
    ts: new Date().toISOString(),
    sha,
    passed: input.passed,
    auditPath,
    sarifPath,
    sbomPath: existsSync(sbomLatest) ? sbomLatest : null,
    controlIds,
  };
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- outDir 派生自受信 root 与常量目录
  appendFileSync(join(outDir, 'manifest.jsonl'), JSON.stringify(entry) + '\n', 'utf-8');
}

export function exportFullAuditBundle(input: AuditExportInput): { auditPath: string | null; sarifPath: string | null } {
  const auditPath = exportAuditRecord(input);
  const sarifPath = exportSarifRecord(input);
  appendAuditManifest(input, auditPath, sarifPath);
  return { auditPath, sarifPath };
}
