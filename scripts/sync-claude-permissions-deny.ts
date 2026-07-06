#!/usr/bin/env bun
/**
 * Sync permissions.deny from permissions-deny.registry.ts to:
 * - .claude/settings.permissions-deny.example.json (repo)
 * - ~/.claude/settings.json (global, merge permissions.deny only)
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDenyRules } from '../.claude/permissions-deny.registry.js';

const REPO_ROOT = join(import.meta.dir, '..');
const REPO_EXAMPLE = join(REPO_ROOT, '.claude', 'settings.permissions-deny.example.json');
const GLOBAL_SETTINGS =
  process.env.CLAUDE_SETTINGS_PATH ?? join(process.env.HOME ?? '', '.claude', 'settings.json');

type CliOptions = {
  dryRun: boolean;
  check: boolean;
  repoOnly: boolean;
};

type SettingsJson = {
  permissions?: {
    deny?: string[];
    allow?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function parseArgs(argv: string[]): CliOptions {
  return {
    dryRun: argv.includes('--dry-run'),
    check: argv.includes('--check'),
    repoOnly: argv.includes('--repo-only'),
  };
}

function buildExampleDocument(denyRules: string[]): SettingsJson {
  return {
    _comment: 'Generated from permissions-deny.registry.ts — do not edit by hand',
    permissions: { deny: denyRules },
  };
}

function readDenyFromFile(path: string): string[] | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as SettingsJson;
  const deny = parsed.permissions?.deny;
  if (!Array.isArray(deny)) return null;
  return deny;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function formatJson(doc: SettingsJson): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function readGlobalSettings(): SettingsJson {
  if (!existsSync(GLOBAL_SETTINGS)) return {};
  return JSON.parse(readFileSync(GLOBAL_SETTINGS, 'utf-8')) as SettingsJson;
}

function mergeGlobalDeny(existing: SettingsJson, denyRules: string[]): SettingsJson {
  return {
    ...existing,
    permissions: {
      ...(existing.permissions ?? {}),
      deny: denyRules,
    },
  };
}

function backupGlobalSettings(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${GLOBAL_SETTINGS}.bak.${timestamp}`;
  copyFileSync(GLOBAL_SETTINGS, backupPath);
  return backupPath;
}

function printHelp(): void {
  console.log(`Usage: bun scripts/sync-claude-permissions-deny.ts [options]

Sync permissions.deny from permissions-deny.registry.ts to repo example and global settings.

Options:
  --dry-run    Preview changes without writing files
  --check      Verify registry matches repo example (and global unless --repo-only)
  --repo-only  Only update .claude/settings.permissions-deny.example.json
  --help       Show this help message

Paths:
  Repo example:  ${REPO_EXAMPLE}
  Global settings: ${GLOBAL_SETTINGS}
`);
}

function runCheck(options: CliOptions, expected: string[]): number {
  const repoDeny = readDenyFromFile(REPO_EXAMPLE);
  let ok = true;

  if (repoDeny === null) {
    console.error(`check failed: repo example missing or has no permissions.deny: ${REPO_EXAMPLE}`);
    ok = false;
  } else if (!arraysEqual(expected, repoDeny)) {
    console.error('check failed: registry deny rules differ from repo example');
    console.error(`  registry: ${expected.length} rules`);
    console.error(`  repo:     ${repoDeny.length} rules`);
    ok = false;
  } else {
    console.log(`check ok: repo example matches registry (${expected.length} rules)`);
  }

  if (!options.repoOnly) {
    const globalDeny = readDenyFromFile(GLOBAL_SETTINGS);
    if (globalDeny === null) {
      console.error(`check failed: global settings missing permissions.deny: ${GLOBAL_SETTINGS}`);
      ok = false;
    } else if (!arraysEqual(expected, globalDeny)) {
      console.error('check failed: registry deny rules differ from global settings');
      console.error(`  registry: ${expected.length} rules`);
      console.error(`  global:   ${globalDeny.length} rules`);
      ok = false;
    } else {
      console.log(`check ok: global settings matches registry (${expected.length} rules)`);
    }
  }

  return ok ? 0 : 1;
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const options = parseArgs(args);
  const denyRules = getDenyRules();
  const exampleDoc = buildExampleDocument(denyRules);
  const exampleJson = formatJson(exampleDoc);

  if (options.check) {
    return runCheck(options, denyRules);
  }

  const repoExists = existsSync(REPO_EXAMPLE);
  const repoCurrent = repoExists ? readFileSync(REPO_EXAMPLE, 'utf-8') : null;
  const repoChanged = repoCurrent !== exampleJson;

  let globalChanged = false;
  let mergedGlobal: SettingsJson | null = null;
  if (!options.repoOnly) {
    const existingGlobal = readGlobalSettings();
    mergedGlobal = mergeGlobalDeny(existingGlobal, denyRules);
    const globalCurrent = existsSync(GLOBAL_SETTINGS) ? readFileSync(GLOBAL_SETTINGS, 'utf-8') : null;
    globalChanged = globalCurrent !== formatJson(mergedGlobal);
  }

  if (options.dryRun) {
    console.log(`dry-run: ${denyRules.length} deny rules from registry`);
    console.log(`  repo example (${REPO_EXAMPLE}): ${repoChanged ? 'would update' : 'unchanged'}`);
    if (!options.repoOnly) {
      console.log(`  global settings (${GLOBAL_SETTINGS}): ${globalChanged ? 'would update' : 'unchanged'}`);
    }
    return 0;
  }

  if (repoChanged) {
    writeFileSync(REPO_EXAMPLE, exampleJson, 'utf-8');
    console.log(`wrote repo example: ${REPO_EXAMPLE} (${denyRules.length} rules)`);
  } else {
    console.log(`repo example unchanged: ${REPO_EXAMPLE}`);
  }

  if (!options.repoOnly && mergedGlobal) {
    if (globalChanged) {
      if (existsSync(GLOBAL_SETTINGS)) {
        const backupPath = backupGlobalSettings();
        console.log(`backed up global settings: ${backupPath}`);
      }
      writeFileSync(GLOBAL_SETTINGS, formatJson(mergedGlobal), 'utf-8');
      console.log(`wrote global settings: ${GLOBAL_SETTINGS} (${denyRules.length} rules)`);
    } else {
      console.log(`global settings unchanged: ${GLOBAL_SETTINGS}`);
    }
  }

  return 0;
}

process.exit(main());
