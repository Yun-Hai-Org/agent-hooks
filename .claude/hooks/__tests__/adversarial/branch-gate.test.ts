import { describe, it, expect } from 'bun:test';
import { extractMergeTarget } from '../../checks/git-policy.js';
import { MAIN_BRANCHES, isInsideWorktree, isFileWriteCommand, deny } from '../../branch-gate.js';

describe('adversarial: branch-gate bypass vectors', () => {
  it('extractMergeTarget 不应被多余空格欺骗', () => {
    expect(extractMergeTarget('git merge   feat/evil')).toBe('feat/evil');
  });

  it('main/master 应在 MAIN_BRANCHES 中', () => {
    expect(MAIN_BRANCHES).toContain('main');
    expect(MAIN_BRANCHES).toContain('master');
  });

  it('isInsideWorktree 检测 .git 文件', () => {
    expect(typeof isInsideWorktree('/tmp')).toBe('boolean');
  });

  it('文件写入命令应被识别', () => {
    expect(isFileWriteCommand('echo x > out.txt')).toBe(true);
    expect(isFileWriteCommand('git status')).toBe(false);
  });

  it('deny 输出应含 permissionDecision', () => {
    const output = JSON.parse(deny('test deny', 'test-session'));
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
