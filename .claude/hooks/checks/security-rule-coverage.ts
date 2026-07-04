import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { BLOCK_DANGEROUS_RULE_IDS, SECURITY_MODULE_TEST_MAP } from '../gate-registry.js';
import { resolveSecurityRuleCoverageConfig } from '../gate-config.js';
import { formatResult, DECISION } from '../security-orchestrator.js';
import { isHooksProject } from './hooks-project.js';
import type { CheckResult } from '../types.js';

const RULE_TAG_RE = /@rule:([a-z0-9-]+)/g;

export function scanTestFilesForRuleIds(testDir: string): Set<string> {
  const found = new Set<string>();
  const stack = [testDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        stack.push(full);
        continue;
      }
      if (!/\.(test|spec)\.(ts|js)$/i.test(name)) continue;
      try {
        const content = readFileSync(full, 'utf-8');
        for (const match of content.matchAll(RULE_TAG_RE)) {
          if (match[1]) found.add(match[1]);
        }
      } catch {
        // skip unreadable
      }
    }
  }

  return found;
}

function missingDangerousRuleIds(found: Set<string>): string[] {
  return BLOCK_DANGEROUS_RULE_IDS.filter((id) => !found.has(id));
}

function missingSecurityModuleTests(cwd: string, modules: readonly string[]): string[] {
  const missing: string[] = [];
  for (const hookId of modules) {
    if (hookId === 'block-dangerous-commands') continue;
    const paths = SECURITY_MODULE_TEST_MAP[hookId] ?? [];
    const exists = paths.some((rel) => {
      try {
        return statSync(join(cwd, '.claude/hooks', rel)).isFile();
      } catch {
        return false;
      }
    });
    if (!exists) missing.push(hookId);
  }
  return missing;
}

export function runSecurityRuleCoverage(cwd?: string): CheckResult {
  const root = cwd ?? process.cwd();
  if (!isHooksProject(root)) {
    return formatResult('security-rule-coverage', DECISION.SKIP, '非 hooks 项目，跳过安全规则覆盖率');
  }

  const config = resolveSecurityRuleCoverageConfig(root);
  const testDir = join(root, '.claude', 'hooks', '__tests__');
  const foundRuleIds = scanTestFilesForRuleIds(testDir);

  const missingRules = missingDangerousRuleIds(foundRuleIds);
  const missingModules = missingSecurityModuleTests(root, config.modules);

  const failures: string[] = [];
  if (missingRules.length > 0) {
    const preview = missingRules.slice(0, 5).join(', ');
    const suffix = missingRules.length > 5 ? ` 等 ${String(missingRules.length)} 条` : '';
    failures.push(`block-dangerous-commands 缺少 @rule 用例：${preview}${suffix}`);
  }
  if (missingModules.length > 0) {
    failures.push(`安全模块缺少测试文件：${missingModules.join(', ')}`);
  }

  if (failures.length > 0) {
    return formatResult('security-rule-coverage', DECISION.DENY, failures.join('；'));
  }

  const covered = BLOCK_DANGEROUS_RULE_IDS.length;
  return formatResult(
    'security-rule-coverage',
    DECISION.ALLOW,
    `安全规则覆盖率达标（block-dangerous ${String(covered)}/${String(covered)} @rule，模块 ${String(config.modules.length)} 个）`,
  );
}
