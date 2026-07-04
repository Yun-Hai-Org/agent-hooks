import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanTestFilesForRuleIds, runSecurityRuleCoverage } from '../checks/security-rule-coverage.js';
import { BLOCK_DANGEROUS_RULE_IDS } from '../gate-registry.js';
import { DECISION } from '../security-orchestrator.js';
import { PROJECT_ROOT } from './helpers.js';

describe('scanTestFilesForRuleIds', () => {
  it('扫描 @rule 标签', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rule-scan-'));
    writeFileSync(
      join(dir, 'sample.test.ts'),
      `
import { describe, it } from 'bun:test';
// @rule:rm-home
describe('rm-home', () => { it('blocks', () => {}); });
// @rule:curl-pipe-sh
`,
    );
    try {
      const found = scanTestFilesForRuleIds(dir);
      expect(found.has('rm-home')).toBe(true);
      expect(found.has('curl-pipe-sh')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('递归扫描子目录', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rule-adv-'));
    const sub = join(dir, 'adversarial');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'adv.test.ts'), '// @rule:fork-bomb\n');
    try {
      expect(scanTestFilesForRuleIds(dir).has('fork-bomb')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runSecurityRuleCoverage', () => {
  it('PROJECT_ROOT 可执行并返回 checkId', () => {
    const r = runSecurityRuleCoverage(PROJECT_ROOT);
    expect(r.checkId).toBe('security-rule-coverage');
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  });

  it('BLOCK_DANGEROUS_RULE_IDS 非空', () => {
    expect(BLOCK_DANGEROUS_RULE_IDS.length).toBeGreaterThan(50);
  });
});
