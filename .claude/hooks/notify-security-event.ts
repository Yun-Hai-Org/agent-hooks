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

/**
 * @param {{ hook?: string; severity?: string; reason?: string; message?: string; session_id?: string }} input
 */
export async function notifySecurityEvent(input) {
  return dispatchSecurityNotification(input, HOOK_NAME);
}

/**
 * @param {{ hook?: string; severity?: string; reason?: string; message?: string; session_id?: string }} input
 */
export function notifySecurityEventAsync(input) {
  notifySecurityEvent(input).catch(() => {});
}
