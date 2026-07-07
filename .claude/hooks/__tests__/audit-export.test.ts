import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildSarifFromResults, exportFullAuditBundle, exportAuditRecord, exportSarifRecord } from '../audit-export.js';
import { formatResult, DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('buildSarifFromResults', () => {
  it('DENY/WARN 结果写入 SARIF runs', () => {
    const results = [
      formatResult('semgrep', DECISION.DENY, '发现漏洞', { controlIds: ['PCI-6.5'] }),
      formatResult('lint', DECISION.WARN, '警告'),
      formatResult('format', DECISION.ALLOW, 'ok'),
      formatResult('skip', DECISION.SKIP, 'skip'),
    ];
    const sarif = buildSarifFromResults(results);
    expect(sarif.version).toBe('2.1.0');
    const run = (sarif.runs as Record<string, unknown>[])[0];
    expect((run?.results as unknown[]).length).toBe(2);
    expect((run?.tool as { driver: { rules: unknown[] } }).driver.rules.length).toBe(2);
  });

  it('空结果集仍返回合法 SARIF', () => {
    const sarif = buildSarifFromResults([]);
    expect(sarif.runs).toBeDefined();
  });
});

describe('exportFullAuditBundle', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/audit-export');
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('写入 jsonl、sarif 与 manifest', () => {
    const results = [formatResult('hook-unit-tests', DECISION.ALLOW, 'ok')];
    const { auditPath, sarifPath } = exportFullAuditBundle({
      hookName: 'pre-merge-commit',
      cwd: repoDir,
      passed: true,
      results,
      gatePathPrefix: 'git.pre-merge-commit',
    });
    expect(auditPath).toBeTruthy();
    expect(sarifPath).toBeTruthy();
    expect(existsSync(auditPath!)).toBe(true);
    expect(existsSync(sarifPath!)).toBe(true);
    const manifestPath = join(repoDir, '.hooks/audit/manifest.jsonl');
    expect(existsSync(manifestPath)).toBe(true);
    const manifestLine = readFileSync(manifestPath, 'utf-8').trim().split('\n').pop()!;
    const manifest = JSON.parse(manifestLine) as { passed: boolean; auditPath: string | null };
    expect(manifest.passed).toBe(true);
    expect(manifest.auditPath).toBe(auditPath);
  });

  it('exportAuditRecord 与 exportSarifRecord 独立可用', () => {
    const input = {
      hookName: 'pre-push',
      cwd: repoDir,
      passed: false,
      results: [formatResult('type-check', DECISION.DENY, 'fail')],
    };
    const auditPath = exportAuditRecord(input);
    const sarifPath = exportSarifRecord(input);
    expect(auditPath).toContain('.hooks/audit');
    expect(sarifPath).toContain('.sarif.json');
    const jsonl = readFileSync(auditPath!, 'utf-8');
    expect(jsonl).toContain('BLOCKED');
  });

  it('sbom latest 存在时 manifest 引用', () => {
    mkdirSync(join(repoDir, '.hooks/sbom'), { recursive: true });
    writeFileSync(join(repoDir, '.hooks/sbom/latest.json'), '{}');
    exportFullAuditBundle({
      hookName: 'pre-merge-commit',
      cwd: repoDir,
      passed: true,
      results: [],
    });
    const manifestPath = join(repoDir, '.hooks/audit/manifest.jsonl');
    const entry = JSON.parse(readFileSync(manifestPath, 'utf-8').trim()) as { sbomPath: string | null };
    expect(entry.sbomPath).toContain('.hooks/sbom/latest.json');
  });
});
