import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { clearGateConfigCache } from '../gate-config.js';
import { clearCooldownState } from '../notification-core.js';
import {
  buildGateBlockedReason,
  shouldNotifyGateBlocked,
  notifyGateBlockedAsync,
  DEFAULT_EXCLUDE_HOOKS,
} from '../gate-blocked-notify.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

const notifyMock = mock(() => undefined);
mock.module('../notify-security-event.js', () => ({
  notifySecurityEventAsync: notifyMock,
}));

function writeOnBlockedYaml(repoDir: string, overrides?: { enabled?: boolean; excludeHooks?: string[] }) {
  mkdirSync(join(repoDir, '.claude'), { recursive: true });
  const enabled = overrides?.enabled ?? true;
  const exclude = overrides?.excludeHooks ?? ['workflow-gate'];
  const excludeBlock = exclude.map((h) => `        - ${h}`).join('\n');
  writeFileSync(
    join(repoDir, '.claude/quality-gate.yaml'),
    `settings:
  notifications:
    timeout: 5s
    cooldown: 5m
    channels:
      wechat:
        url: ""
    onBlocked:
      enabled: ${enabled ? 'true' : 'false'}
      excludeHooks:
${excludeBlock}
`,
  );
  clearGateConfigCache();
}

describe('gate-blocked-notify', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/gate-blocked-notify');
    notifyMock.mockClear();
    clearGateConfigCache();
    clearCooldownState();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
    clearCooldownState();
  });

  it('buildGateBlockedReason 应合并 reason 与 checks', () => {
    const reason = buildGateBlockedReason({
      hook: 'quality-gate',
      reason: '质量门失败',
      checks: [{ checkId: 'lint', decision: 'deny', message: 'eslint error' }],
    });
    expect(reason).toContain('质量门失败');
    expect(reason).toContain('[lint]');
  });

  it('shouldNotifyGateBlocked 应尊重 excludeHooks', () => {
    writeOnBlockedYaml(repoDir, { excludeHooks: ['workflow-gate', 'auto-commit'] });
    expect(shouldNotifyGateBlocked('workflow-gate', repoDir)).toBe(false);
    expect(shouldNotifyGateBlocked('auto-commit', repoDir)).toBe(false);
    expect(shouldNotifyGateBlocked('git-ship-gate', repoDir)).toBe(true);
  });

  it('onBlocked disabled 时不应通知', () => {
    writeOnBlockedYaml(repoDir, { enabled: false });
    notifyGateBlockedAsync({ hook: 'auto-commit', reason: 'blocked', cwd: repoDir });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('notifyGateBlockedAsync 应调用 notifySecurityEventAsync', () => {
    writeOnBlockedYaml(repoDir);
    notifyGateBlockedAsync({
      hook: 'auto-commit',
      reason: 'ship incomplete',
      cwd: repoDir,
      session_id: 'sess-1',
    });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const arg = notifyMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.hook).toBe('auto-commit');
    expect(arg.reason).toContain('ship incomplete');
  });

  it('DEFAULT_EXCLUDE_HOOKS 含 workflow 噪声钩子', () => {
    expect(DEFAULT_EXCLUDE_HOOKS.has('workflow-gate')).toBe(true);
    expect(DEFAULT_EXCLUDE_HOOKS.has('orchestrator-gate')).toBe(true);
  });
});
