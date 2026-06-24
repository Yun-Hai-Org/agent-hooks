#!/usr/bin/env bun
/**
 * Notify Security Event - 共享 Webhook 通知（Claude Notification + Cursor BLOCKED 直连）
 */

import { dispatchSecurityNotification } from './notification-core.js';

export {
  isCoolingDown,
  recordSent,
  clearCooldownState,
  mapSeverityEmoji,
  parseNotificationMessage,
  makeEventKey,
  formatWechatMessage,
  formatFeishuMessage,
  formatSlackMessage,
  sendWebhook,
  getConfiguredChannels,
  notifyAllChannels,
  DEFAULT_COOLDOWN_MS,
} from './notification-core.js';

const HOOK_NAME = 'notify-security-event';

interface SecurityEventInput {
  hook?: string;
  severity?: string;
  reason?: string;
  message?: string;
  session_id?: string;
}

export async function notifySecurityEvent(input: SecurityEventInput) {
  return dispatchSecurityNotification(input, HOOK_NAME);
}

export function notifySecurityEventAsync(input: SecurityEventInput) {
  void notifySecurityEvent(input).catch(() => undefined);
}
