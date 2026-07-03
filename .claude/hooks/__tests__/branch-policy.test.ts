import { describe, it, expect } from 'bun:test';
import {
  branchMatchesPattern,
  shouldRunFullGateForBranch,
  shouldRunFullGateForBranches,
  parsePrePushLocalBranches,
  describePushMergeBranchSkip,
  refToBranchName,
} from '../checks/branch-policy.js';
import type { ResolvedPushMergeBranchPolicy } from '../gate-config.js';

describe('branch-policy', () => {
  const selectedPolicy: ResolvedPushMergeBranchPolicy = {
    mode: 'selected',
    include: ['main', 'master', 'feat/*', 'release/**'],
    exclude: ['wip/*'],
  };

  it('mode all 始终运行', () => {
    const policy: ResolvedPushMergeBranchPolicy = { mode: 'all', include: [], exclude: [] };
    expect(shouldRunFullGateForBranch('anything', policy)).toBe(true);
  });

  it('selected include 匹配', () => {
    expect(shouldRunFullGateForBranch('main', selectedPolicy)).toBe(true);
    expect(shouldRunFullGateForBranch('feat/foo', selectedPolicy)).toBe(true);
    expect(shouldRunFullGateForBranch('release/2026/q1', selectedPolicy)).toBe(true);
  });

  it('selected exclude 优先', () => {
    expect(shouldRunFullGateForBranch('wip/test', selectedPolicy)).toBe(false);
  });

  it('selected 未匹配 include 跳过', () => {
    expect(shouldRunFullGateForBranch('eval-console', selectedPolicy)).toBe(false);
  });

  it('selected include 为空时不运行', () => {
    const policy: ResolvedPushMergeBranchPolicy = { mode: 'selected', include: [], exclude: [] };
    expect(shouldRunFullGateForBranch('main', policy)).toBe(false);
  });

  it('shouldRunFullGateForBranches 任一命中', () => {
    expect(shouldRunFullGateForBranches(['wip/a', 'feat/b'], selectedPolicy)).toBe(true);
    expect(shouldRunFullGateForBranches(['wip/a', 'other/b'], selectedPolicy)).toBe(false);
  });

  it('branchMatchesPattern glob', () => {
    expect(branchMatchesPattern('feat/foo', 'feat/*')).toBe(true);
    expect(branchMatchesPattern('feat/foo/bar', 'feat/*')).toBe(false);
    expect(branchMatchesPattern('feat/foo/bar', 'feat/**')).toBe(true);
  });

  it('parsePrePushLocalBranches', () => {
    const lines = ['refs/heads/main abc def ghi', 'refs/heads/feat/x 1 2 3'];
    expect(parsePrePushLocalBranches(lines)).toEqual(['main', 'feat/x']);
  });

  it('parsePrePushLocalBranches 忽略非 heads ref', () => {
    expect(parsePrePushLocalBranches(['refs/tags/v1.0 abc', ''])).toEqual([]);
  });

  it('refToBranchName 解析 refs/heads', () => {
    expect(refToBranchName('refs/heads/main')).toBe('main');
    expect(refToBranchName('main')).toBe('main');
  });
});
