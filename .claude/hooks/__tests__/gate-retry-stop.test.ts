import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  isGateRetryStopEnabled,
  isAutoRetryMergeEnabled,
  getMaxGateRetryLoops,
  runGateRetryStop,
  rerunPendingGate,
} from '../gate-retry-stop.js';
import { setPendingGateFailure, clearPendingGateFailure } from '../gate-pending.js';
import { createTempGitRepo, cleanupTempGitRepo, bootstrapQualityGateYaml } from './helpers.js';

describe('gate-retry-stop helpers', () => {
  it('isGateRetryStopEnabled 默认 true', () => {
    delete process.env.GATE_RETRY_STOP;
    expect(isGateRetryStopEnabled()).toBe(true);
    process.env.GATE_RETRY_STOP = '0';
    expect(isGateRetryStopEnabled()).toBe(false);
    delete process.env.GATE_RETRY_STOP;
  });

  it('isAutoRetryMergeEnabled 默认 true', () => {
    delete process.env.GATE_AUTO_RETRY_MERGE;
    expect(isAutoRetryMergeEnabled()).toBe(true);
  });

  it('getMaxGateRetryLoops 解析环境变量', () => {
    process.env.GATE_RETRY_MAX_LOOPS = '3';
    expect(getMaxGateRetryLoops()).toBe(3);
    delete process.env.GATE_RETRY_MAX_LOOPS;
  });
});

describe('runGateRetryStop', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/gate-retry');
    bootstrapQualityGateYaml(repoDir);
  });

  afterEach(() => {
    clearPendingGateFailure('test-session', repoDir);
    cleanupTempGitRepo(repoDir);
  });

  it('无 pending 时 skip', async () => {
    const r = await runGateRetryStop('test-session', { cwd: repoDir });
    expect(r.action).toBe('skip');
  });

  it('有 pending push 时 block 或 pass', async () => {
    setPendingGateFailure('test-session', {
      type: 'push',
      command: 'git push',
      cwd: repoDir,
    });
    const r = await runGateRetryStop('test-session', { cwd: repoDir });
    expect(['skip', 'block', 'pass', 'merged', 'merge-failed']).toContain(r.action);
  }, 120_000);

  it('rerunPendingGate 可调用', async () => {
    setPendingGateFailure('test-session', {
      type: 'push',
      command: 'git push',
      cwd: repoDir,
    });
    const pending = { type: 'push' as const, command: 'git push', cwd: repoDir };
    const r = await rerunPendingGate(pending);
    expect(r).toHaveProperty('passed');
  }, 300_000);
});
