import { describe, it, expect, beforeEach } from 'bun:test';
import {
  clearCooldownState,
  formatFeishuConversationEndMessage,
  formatFeishuMessage,
  formatSlackConversationEndMessage,
  formatSlackMessage,
  formatWechatConversationEndMessage,
  formatWechatMessage,
  isCoolingDown,
  makeEventKey,
  mapSeverityEmoji,
  parseNotificationMessage,
  recordSent,
  truncateSummary,
  type ConversationEndEvent,
} from '../notification-core.js';

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
    const body = formatWechatMessage({ hook: 'x', severity: 'info', reason: 'test' }, '2026-06-08 12:00:00');
    expect((body.markdown as { content: string }).content).toContain('test');
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
});
