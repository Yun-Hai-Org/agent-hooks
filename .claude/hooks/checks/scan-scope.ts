import { resolveScanScope, type ResolvedScanScope } from '../gate-config.js';

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
