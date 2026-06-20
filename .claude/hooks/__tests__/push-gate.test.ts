import { describe, it, expect } from 'bun:test';
import { isGitPushCommand } from '../checks/git-policy.js';

describe('push-gate', () => {
  it('应识别 git push 命令', () => {
    expect(isGitPushCommand('git push origin feat/test')).toBe(true);
    expect(isGitPushCommand('git commit -m "x"')).toBe(false);
  });
});
