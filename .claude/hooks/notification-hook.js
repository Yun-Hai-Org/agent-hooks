#!/usr/bin/env bun
/**
 * Notification Hook - 安全事件通知钩子（Claude Notification 入口）
 */

import { readStdin, safeMain } from './security-orchestrator.js';
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

const HOOK_NAME = 'notification-hook';

/**
 * @param {object} data
 */
export async function handleNotification(data) {
  const message = data?.tool_input?.message || '';
  const session_id = data?.session_id || '';
  return dispatchSecurityNotification({ message, session_id }, HOOK_NAME);
}

async function main() {
  const data = await readStdin();
  await handleNotification(data);
  console.log('{}');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  safeMain(main);
}

export { HOOK_NAME };
