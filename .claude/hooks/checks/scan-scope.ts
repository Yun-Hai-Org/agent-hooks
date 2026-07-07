import { relative } from 'path';
import { resolveScanScope, type ResolvedScanScope } from '../gate-config.js';
import { getStagedFiles } from './git-policy.js';
import { execCommand } from '../security-orchestrator.js';

export type { ResolvedScanScope };

export function getScanScope(cwd?: string): ResolvedScanScope {
  return resolveScanScope(cwd ?? process.cwd());
}

export function buildSemgrepExcludeFlags(scope: ResolvedScanScope): string {
  return scope.exclude.map((d) => `--exclude "${d}"`).join(' ');
}

export function buildTrivySkipDirArgs(scope: ResolvedScanScope): string {
  return scope.exclude.map((d) => `--skip-dirs "${d}"`).join(' ');
}

export function resolveScanTargets(scope: ResolvedScanScope, fallback = '.'): string {
  if (scope.include.length === 0) return fallback;
  return scope.include.map((p) => `"${p.replace(/\/$/, '')}"`).join(' ');
}

export function filterPathsByScope(files: string[], scope: ResolvedScanScope): string[] {
  if (scope.include.length === 0) {
    return files.filter((f) => !scope.exclude.some((ex) => f.startsWith(ex.replace(/\/$/, ''))));
  }
  return files.filter((f) => {
    const inInclude = scope.include.some((inc) => f.startsWith(inc.replace(/\/$/, '')));
    if (!inInclude) return false;
    return !scope.exclude.some((ex) => f.startsWith(ex.replace(/\/$/, '')));
  });
}

export function isRepoRelativePathInScope(relativePath: string, cwd?: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const scope = getScanScope(cwd);
  return filterPathsByScope([normalized], scope).length > 0;
}

export function getScopedStagedFiles(cwd?: string): string[] {
  const root = cwd ?? process.cwd();
  return filterPathsByScope(getStagedFiles(root), getScanScope(root));
}

export function repoRelativePathFromAbs(absPath: string, gitRoot: string): string | null {
  const rel = relative(gitRoot, absPath).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return null;
  return rel;
}

export function isAbsPathInScanScope(absPath: string, gitRoot: string): boolean {
  const rel = repoRelativePathFromAbs(absPath, gitRoot);
  if (rel === null) return false;
  return isRepoRelativePathInScope(rel, gitRoot);
}

export function resolveGitRootForPath(absPath: string, fallbackCwd: string): string {
  const result = execCommand('git rev-parse --show-toplevel', { cwd: absPath });
  if (result.success && result.stdout.trim()) return result.stdout.trim();
  return fallbackCwd;
}
