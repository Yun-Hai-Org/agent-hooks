import { describe, it, expect } from 'bun:test';
import { isGitPushCommand, isGitCommitCommand, isGitMergeCommand } from '../checks/git-policy.js';

describe('adversarial: git-policy command detection', () => {
  it('应识别变体 git commit', () => {
    expect(isGitCommitCommand('git commit -m "feat: x"')).toBe(true);
    expect(isGitCommitCommand('git  commit -m "feat: x"')).toBe(true);
    expect(isGitCommitCommand('git status')).toBe(false);
  });

  it('应识别变体 git push', () => {
    expect(isGitPushCommand('git push origin feat/x')).toBe(true);
    expect(isGitPushCommand('git push')).toBe(true);
    expect(isGitPushCommand('git pull')).toBe(false);
  });

  it('应识别变体 git merge', () => {
    expect(isGitMergeCommand('git merge --no-ff feat/x')).toBe(true);
    expect(isGitMergeCommand('git merge feat/x')).toBe(true);
    expect(isGitMergeCommand('git checkout feat/x')).toBe(false);
  });
});
