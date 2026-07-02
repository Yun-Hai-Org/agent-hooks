import { describe, it, expect, beforeEach } from 'bun:test';
import {
  clearCooldownState,
  isCoolingDown,
  makeEventKey,
  mapSeverityEmoji,
  parseNotificationMessage,
  recordSent,
  truncateSummary,
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
});
