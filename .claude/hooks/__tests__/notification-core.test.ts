import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  clearCooldownState,
  formatFeishuConversationEndMessage,
  formatFeishuMessage,
  formatSlackConversationEndMessage,
  formatSlackMessage,
  formatWechatConversationEndMessage,
  formatWechatMessage,
  getConfiguredChannels,
  isCoolingDown,
  makeEventKey,
  makeGitOperationEventKey,
  makeConversationEndEventKey,
  mapSeverityEmoji,
  parseNotificationMessage,
  recordSent,
  truncateSummary,
  formatWechatGitOperationMessage,
  type ConversationEndEvent,
  type GitOperationEvent,
} from '../notification-core.js';
import { clearGateConfigCache } from '../gate-config.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('notification-core', () => {
  beforeEach(() => {
    clearCooldownState();
  });

  it('mapSeverityEmoji 应映射已知 severity', () => {
    expect(mapSeverityEmoji('critical')).toBe('🔴');
    expect(mapSeverityEmoji('unknown')).toBe('⚠️');
  });

  it('parseNotificationMessage 应解析 hook 与 severity', () => {
    const event = parseNotificationMessage('[block-dangerous-commands] HIGH: rm -rf /');
    expect(event.hook).toBe('block-dangerous-commands');
    expect(event.severity).toBe('high');
  });

  it('makeEventKey 应组合 hook 与 severity', () => {
    expect(makeEventKey({ hook: 'branch-gate', severity: 'high', reason: 'x' })).toBe('branch-gate:high');
  });

  it('isCoolingDown 应在 cooldown 内返回 true', () => {
    recordSent('test:event');
    expect(isCoolingDown('test:event', 60_000)).toBe(true);
    expect(isCoolingDown('other:event', 60_000)).toBe(false);
  });

  it('truncateSummary 空文本返回空字符串', () => {
    expect(truncateSummary('', 10)).toBe('');
  });

  it('formatWechatMessage 应生成 markdown 内容', () => {
    const body = formatWechatMessage(
      { hook: 'x', severity: 'info', reason: 'test', projectName: 'proj', platform: 'Cursor' },
      '2026-06-08 12:00:00',
    );
    const content = (body.markdown as { content: string }).content;
    expect(content).toContain('test');
    expect(content).toContain('**安全事件通知**');
    expect(content).toContain('proj');
  });

  it('formatFeishuMessage 应生成 interactive 卡片', () => {
    const body = formatFeishuMessage({ hook: 'x', severity: 'high', reason: 'alert' }, '2026-06-08 12:00:00');
    expect(body.msg_type).toBe('interactive');
  });

  it('formatSlackMessage 应生成 attachments', () => {
    const body = formatSlackMessage({ hook: 'x', severity: 'low', reason: 'note' }, '2026-06-08 12:00:00');
    expect(Array.isArray(body.attachments)).toBe(true);
  });

  it('formatConversationEnd 消息应包含三端模板', () => {
    const event: ConversationEndEvent = {
      platform: 'Cursor',
      projectName: 'demo',
      sessionId: 's1',
      summaryText: 'done',
    };
    expect(formatWechatConversationEndMessage(event, '2026/6/30', 100).msgtype).toBe('markdown');
    expect(formatFeishuConversationEndMessage(event, '2026/6/30', 100).msg_type).toBe('interactive');
    expect(formatSlackConversationEndMessage(event, '2026/6/30', 100).attachments).toBeDefined();
  });

  it('getConfiguredChannels 无 url 时返回空数组', () => {
    const repoDir = createTempGitRepo('feat/notify-core');
    try {
      mkdirSync(join(repoDir, '.claude'), { recursive: true });
      writeFileSync(
        join(repoDir, '.claude/quality-gate.yaml'),
        `settings:
  notifications:
    channels:
      wechat:
        url: ""
`,
      );
      clearGateConfigCache();
      expect(getConfiguredChannels(repoDir)).toEqual([]);
    } finally {
      cleanupTempGitRepo(repoDir);
      clearGateConfigCache();
    }
  });

  it('makeEventKey 应在 agentId 存在时附加 agent 作用域', () => {
    expect(makeEventKey({ hook: 'branch-gate', severity: 'high', reason: 'x' })).toBe('branch-gate:high');
    expect(makeEventKey({ hook: 'branch-gate', severity: 'high', reason: 'x', agentId: 'a1' })).toBe('branch-gate:high:a1');
  });

  it('makeGitOperationEventKey 同 sha 不同 agent 应产出不同 key（不合并频控）', () => {
    expect(makeGitOperationEventKey('commit', 'abc123')).toBe('git-operation:commit:abc123');
    expect(makeGitOperationEventKey('commit', 'abc123', 'a1')).toBe('git-operation:commit:abc123:a1');
    expect(makeGitOperationEventKey('commit', 'abc123', 'a2')).toBe('git-operation:commit:abc123:a2');
    expect(makeGitOperationEventKey('commit', 'abc123', 'a1')).not.toBe(makeGitOperationEventKey('commit', 'abc123', 'a2'));
  });

  it('makeGitOperationEventKey 无 agent_id 时保持向后兼容', () => {
    expect(makeGitOperationEventKey('push', 'sha-x')).toBe('git-operation:push:sha-x');
    expect(makeGitOperationEventKey('push', '')).toBe('git-operation:push:unknown');
  });

  it('makeConversationEndEventKey 应按 agent_id 作用域化', () => {
    expect(makeConversationEndEventKey('s1')).toBe('conversation-end:s1');
    expect(makeConversationEndEventKey('s1', 'a1')).toBe('conversation-end:s1:a1');
    expect(makeConversationEndEventKey('s1', 'a1')).not.toBe(makeConversationEndEventKey('s1', 'a2'));
  });

  it('formatWechatGitOperationMessage 应在 agent_id 存在时含归属 agent 行', () => {
    const body = formatWechatGitOperationMessage(
      {
        operation: 'commit',
        projectName: 'demo',
        platform: 'Git',
        branch: 'feat/test',
        summaryText: 'feat: add',
        agent_id: 'agent-42',
      } as GitOperationEvent,
      '2026/7/3 12:00:00',
      1500,
    );
    const content = (body.markdown as { content: string }).content;
    expect(content).toContain('**归属 agent**');
    expect(content).toContain('agent-42');
  });

  it('formatWechatGitOperationMessage 无 agent_id 时不含归属 agent 行', () => {
    const body = formatWechatGitOperationMessage(
      {
        operation: 'commit',
        projectName: 'demo',
        platform: 'Git',
        branch: 'feat/test',
        summaryText: 'feat: add',
      } as GitOperationEvent,
      '2026/7/3 12:00:00',
      1500,
    );
    const content = (body.markdown as { content: string }).content;
    expect(content).not.toContain('归属 agent');
  });
});
