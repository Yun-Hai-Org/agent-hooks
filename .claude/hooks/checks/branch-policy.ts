import { resolvePushMergeBranchPolicy, type ResolvedPushMergeBranchPolicy } from '../gate-config.js';

export type { ResolvedPushMergeBranchPolicy };

function globPatternToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\/+$/, '');
  let regex = '';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (!ch) continue;
    if (ch === '*' && normalized[i + 1] === '*') {
      regex += '.*';
      i++;
      continue;
    }
    if (ch === '*') {
      regex += '[^/]*';
      continue;
    }
    regex += ch.replace(/[\\^$+?.()|[\]{}]/g, '\\$&');
  }
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- 分支 glob 来自受信 quality-gate.yaml，已转义字面量并限制为分支名匹配
  return new RegExp(`^${regex}$`);
}

export function branchMatchesPattern(branchName: string, pattern: string): boolean {
  const trimmed = branchName.trim();
  if (!trimmed || !pattern.trim()) return false;
  return globPatternToRegExp(pattern.trim()).test(trimmed);
}

export function shouldRunFullGateForBranch(branchName: string, policy: ResolvedPushMergeBranchPolicy): boolean {
  if (policy.mode === 'all') return true;
  const name = branchName.trim();
  if (!name) return false;
  if (policy.exclude.some((pattern) => branchMatchesPattern(name, pattern))) return false;
  if (policy.include.length === 0) return false;
  return policy.include.some((pattern) => branchMatchesPattern(name, pattern));
}

export function shouldRunFullGateForBranches(branchNames: string[], policy: ResolvedPushMergeBranchPolicy): boolean {
  if (policy.mode === 'all') return true;
  const names = branchNames.map((b) => b.trim()).filter(Boolean);
  if (names.length === 0) return false;
  return names.some((name) => shouldRunFullGateForBranch(name, policy));
}

export function resolvePushMergeBranchPolicyForCwd(cwd?: string): ResolvedPushMergeBranchPolicy {
  return resolvePushMergeBranchPolicy(cwd ?? process.cwd());
}

export function parsePrePushLocalBranches(lines: string[]): string[] {
  const branches: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const localRef = parts[0];
    if (!localRef?.startsWith('refs/heads/')) continue;
    branches.push(localRef.slice('refs/heads/'.length));
  }
  return branches;
}

export function refToBranchName(ref: string): string {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  return ref;
}

export function describePushMergeBranchSkip(policy: ResolvedPushMergeBranchPolicy, branches: string[]): string {
  const listed = branches.length > 0 ? branches.join(', ') : '(unknown)';
  return `push/merge full 门跳过：分支 ${listed} 未匹配 settings.pushMergeBranches (mode=${policy.mode})`;
}
