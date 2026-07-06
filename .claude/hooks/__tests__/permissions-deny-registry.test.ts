import { describe, it, expect } from 'bun:test';
import { BLOCK_DANGEROUS_RULE_IDS } from '../gate-registry.js';
import { getDenyRules, PERMISSION_DENY_REGISTRY } from '../../permissions-deny.registry.js';

describe('permissions-deny-registry', () => {
  it('every BLOCK_DANGEROUS_RULE_IDS id has registry entry', () => {
    const registryIds = new Set(PERMISSION_DENY_REGISTRY.map((entry) => entry.id));
    for (const id of BLOCK_DANGEROUS_RULE_IDS) {
      expect(registryIds.has(id)).toBe(true);
    }
  });

  it('getDenyRules returns sorted unique strings without hookOnly rules', () => {
    const rules = getDenyRules();
    expect(rules).toEqual([...rules].sort());
    expect(rules.length).toBe(new Set(rules).size);

    const hookOnlyRuleStrings = PERMISSION_DENY_REGISTRY.filter((entry) => entry.hookOnly && entry.rule).map(
      (entry) => entry.rule as string,
    );
    for (const rule of hookOnlyRuleStrings) {
      expect(rules).not.toContain(rule);
    }

    const hookOnlyIds = new Set(
      PERMISSION_DENY_REGISTRY.filter((entry) => entry.hookOnly).map((entry) => entry.id),
    );
    for (const entry of PERMISSION_DENY_REGISTRY) {
      if (entry.hookOnly && entry.rule) {
        expect(rules).not.toContain(entry.rule);
      }
      if (entry.hookOnly && !entry.rule) {
        expect(hookOnlyIds.has(entry.id)).toBe(true);
      }
    }
  });

  it('Bash rules do not contain command:', () => {
    for (const rule of getDenyRules()) {
      if (rule.startsWith('Bash(')) {
        expect(rule).not.toContain('command:');
      }
    }
  });

  it('Read/Edit rules use //**/ or ~/. prefix', () => {
    for (const rule of getDenyRules()) {
      if (rule.startsWith('Read(') || rule.startsWith('Edit(')) {
        const inner = rule.slice(rule.indexOf('(') + 1, -1);
        expect(inner.startsWith('//**/') || inner.startsWith('~/')).toBe(true);
      }
    }
  });

  it('getDenyRules has at least 50 rules', () => {
    expect(getDenyRules().length).toBeGreaterThanOrEqual(50);
  });
});
