import { existsSync, readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { execCommand, LOG_DIR } from './security-orchestrator.js';

export const HOOKS_EXCLUDE_FILE = join(LOG_DIR, '..', 'hooks-exclude');
export const QUALITY_GATE_CONFIG_KEY = 'hooks.qualityGate';

function normalizeRepoPath(path: string): string {
  try {
    return realpathSync(path).replace(/\/+$/, '');
  } catch {
    return path.replace(/\/+$/, '');
  }
}

function readExcludeList(): string[] {
  if (!existsSync(HOOKS_EXCLUDE_FILE)) return [];
  const lines = readFileSync(HOOKS_EXCLUDE_FILE, 'utf-8').split('\n');
  return lines.map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));
}

function matchesExcludeEntry(repoRoot: string, entry: string): boolean {
  const normalizedEntry = entry.endsWith('/') ? entry.slice(0, -1) : entry;
  const normalizedRoot = normalizeRepoPath(repoRoot);
  const normalizedEntryPath = normalizeRepoPath(normalizedEntry);

  if (entry.endsWith('/')) {
    return normalizedRoot === normalizedEntryPath || normalizedRoot.startsWith(`${normalizedEntryPath}/`);
  }
  return normalizedRoot === normalizedEntryPath;
}

function isExcludedByList(repoRoot: string): boolean {
  return readExcludeList().some((entry) => matchesExcludeEntry(repoRoot, entry));
}

function isExcludedByLocalConfig(repoRoot: string): boolean {
  const result = execCommand(`git config --local --get ${QUALITY_GATE_CONFIG_KEY}`, { cwd: repoRoot });
  if (!result.success) return false;
  const value = result.stdout.trim().toLowerCase();
  return value === 'false' || value === '0' || value === 'no' || value === 'off';
}

export function isQualityGateExcluded(cwd: string): boolean {
  return isExcludedByLocalConfig(cwd) || isExcludedByList(cwd);
}

export function getQualityGateExcludeReason(cwd: string): string | null {
  if (isExcludedByLocalConfig(cwd)) {
    return `git config --local ${QUALITY_GATE_CONFIG_KEY}=false`;
  }
  if (isExcludedByList(cwd)) {
    return `listed in ${HOOKS_EXCLUDE_FILE}`;
  }
  return null;
}
