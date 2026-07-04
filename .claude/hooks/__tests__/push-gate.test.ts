import { describe, it, expect } from 'bun:test';
import { isGitPushCommand } from '../checks/git-policy.js';
import { main as pushGateMain } from '../push-gate.js';

describe('push-gate', () => {
  it('应识别 git push 命令', () => {
    expect(isGitPushCommand('git push origin feat/test')).toBe(true);
    expect(isGitPushCommand('git commit -m "x"')).toBe(false);
  });

  it('模块 main 可加载', () => {
    expect(typeof pushGateMain).toBe('function');
  });
});
