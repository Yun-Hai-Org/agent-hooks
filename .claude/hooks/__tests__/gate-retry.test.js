import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { LOG_DIR } from '../security-orchestrator.js';
import {
  setPendingGateFailure,
  getPendingGateFailure,
  clearPendingGateFailure,
} from '../gate-pending.js';
import { buildGateDenyReason, buildGateRetryPassMessage } from '../gate-fix.js';

const PENDING_FILE = join(LOG_DIR, 'gate-pending.json');

describe('gate-pending', () => {
  beforeEach(() => {
    clearPendingGateFailure('sess-1');
    if (existsSync(PENDING_FILE)) rmSync(PENDING_FILE, { force: true });
  });

  afterEach(() => {
    clearPendingGateFailure('sess-1');
  });

  it('应写入并读取 pending', () => {
    setPendingGateFailure('sess-1', {
      type: 'push',
      command: 'git push origin feat/x',
      cwd: '/tmp',
    });
    const pending = getPendingGateFailure('sess-1');
    expect(pending?.type).toBe('push');
    expect(pending?.command).toContain('git push');
  });

  it('clear 后应为空', () => {
    setPendingGateFailure('sess-1', { type: 'merge', command: 'git merge feat/x', cwd: '/tmp', sourceBranch: 'feat/x' });
    clearPendingGateFailure('sess-1');
    expect(getPendingGateFailure('sess-1')).toBeNull();
  });
});

describe('gate-fix', () => {
  it('buildGateDenyReason 应包含命令与检查摘要', () => {
    const reason = buildGateDenyReason('push-gate', 'git push', {
      results: [{ checkId: 'semgrep', decision: 'deny', message: '漏洞' }],
    });
    expect(reason).toContain('push-gate');
    expect(reason).toContain('git push');
    expect(reason).toContain('semgrep');
  });

  it('buildGateRetryPassMessage 提示手动重试', () => {
    const msg = buildGateRetryPassMessage('merge-gate', 'git merge feat/a');
    expect(msg).toContain('手动');
    expect(msg).toContain('git merge feat/a');
  });
});
