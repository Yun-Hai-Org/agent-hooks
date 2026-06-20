import { describe, it, expect } from 'bun:test';
import { formatDenyOutput } from '../hook-adapter.js';

describe('cursor parity', () => {
  it('branch-gate deny 在 cursor 平台应返回 permission deny', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'cursor';
    const out = JSON.parse(formatDenyOutput('deny', '🔒 [branch-gate] test'));
    expect(out.permission).toBe('deny');
    expect(out.user_message).toContain('branch-gate');
    process.env.HOOK_PLATFORM = prev;
  });

  it('protect-secrets deny 在 cursor 平台应返回 permission deny', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'cursor';
    const out = JSON.parse(formatDenyOutput('deny', '[env-file] blocked'));
    expect(out.permission).toBe('deny');
    process.env.HOOK_PLATFORM = prev;
  });
});
