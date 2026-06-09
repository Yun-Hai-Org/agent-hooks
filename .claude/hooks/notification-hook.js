#!/usr/bin/env bun
/**
 * Notification Hook - 安全事件通知钩子
 * 当安全拦截事件发生时，通过 Webhook 发送通知到企业微信/飞书/Slack
 *
 * 功能：
 * 1. 接收 Claude Code Notification 事件
 * 2. 解析安全事件信息，格式化为各平台消息
 * 3. 通过 Webhook 发送通知（支持企业微信、飞书、Slack）
 * 4. 5 分钟频控：同一事件类型不重复发送
 * 5. fail-open：URL 未配置或发送失败时静默跳过
 *
 * 环境变量配置：
 * - NOTIFY_WEBHOOK_URL: 企业微信 Webhook URL
 * - NOTIFY_FEISHU_URL: 飞书 Webhook URL
 * - NOTIFY_SLACK_URL: Slack Webhook URL
 * - NOTIFY_COOLDOWN_MS: 频控间隔（默认 300000 = 5 分钟）
 */

import { readStdin, log, safeMain } from './security-orchestrator.js';

const HOOK_NAME = 'notification-hook';
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟

// ─── 频控状态 ────────────────────────────────────────────────────────────────

/** @type {Map<string, number>} 最近发送时间记录 */
const lastSentMap = new Map();

/**
 * 检查是否在冷却期内
 * @param {string} eventKey - 事件唯一标识
 * @param {number} cooldownMs - 冷却时间（毫秒）
 * @returns {boolean} true = 应跳过（在冷却期内）
 */
export function isCoolingDown(eventKey, cooldownMs = DEFAULT_COOLDOWN_MS) {
  const lastSent = lastSentMap.get(eventKey);
  if (lastSent === undefined) return false;
  return Date.now() - lastSent < cooldownMs;
}

/**
 * 记录发送时间
 * @param {string} eventKey
 */
export function recordSent(eventKey) {
  lastSentMap.set(eventKey, Date.now());
}

/**
 * 清除频控状态（测试用）
 */
export function clearCooldownState() {
  lastSentMap.clear();
}

// ─── 事件解析 ────────────────────────────────────────────────────────────────

/**
 * 安全事件级别映射
 * @param {string} severity
 * @returns {string}
 */
export function mapSeverityEmoji(severity) {
  const map = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵',
    info: 'ℹ️',
  };
  return map[severity?.toLowerCase()] || '⚠️';
}

/**
 * 从通知消息中提取结构化信息
 * @param {string} message - 原始通知消息
 * @returns {{ hook: string, severity: string, reason: string }}
 */
export function parseNotificationMessage(message) {
  if (!message || typeof message !== 'string') {
    return { hook: 'unknown', severity: 'info', reason: message || '' };
  }

  // 尝试提取 hook 名称：匹配 [hook-name] 格式
  const hookMatch = message.match(/\[([a-z][a-z0-9-]*)\]/);
  const hook = hookMatch ? hookMatch[1] : 'unknown';

  // 提取严重级别关键词
  let severity = 'info';
  if (/CRITICAL|致命/i.test(message)) severity = 'critical';
  else if (/HIGH|高危|拦截|阻止|阻断|deny/i.test(message)) severity = 'high';
  else if (/MEDIUM|中等|警告|warn/i.test(message)) severity = 'medium';
  else if (/LOW|低危/i.test(message)) severity = 'low';

  return { hook, severity, reason: message };
}

/**
 * 生成事件唯一标识（用于频控去重）
 * @param {{ hook: string, severity: string }} event
 * @returns {string}
 */
export function makeEventKey(event) {
  return `${event.hook}:${event.severity}`;
}

// ─── Webhook 消息格式化 ──────────────────────────────────────────────────────

/**
 * 格式化为企业微信 Markdown 消息
 * @param {{ hook: string, severity: string, reason: string }} event
 * @param {string} timestamp
 * @returns {object}
 */
export function formatWechatMessage(event, timestamp) {
  const emoji = mapSeverityEmoji(event.severity);
  return {
    msgtype: 'markdown',
    markdown: {
      content: [
        `${emoji} **Claude Code 安全事件通知**`,
        '',
        `> **钩子**: ${event.hook}`,
        `> **级别**: ${event.severity.toUpperCase()}`,
        `> **详情**: ${event.reason}`,
        `> **时间**: ${timestamp}`,
      ].join('\n'),
    },
  };
}

/**
 * 格式化为飞书消息卡片
 * @param {{ hook: string, severity: string, reason: string }} event
 * @param {string} timestamp
 * @returns {object}
 */
export function formatFeishuMessage(event, timestamp) {
  const emoji = mapSeverityEmoji(event.severity);
  const colorMap = {
    critical: 'red',
    high: 'orange',
    medium: 'yellow',
    low: 'blue',
    info: 'grey',
  };
  const color = colorMap[event.severity] || 'grey';

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: `${emoji} Claude Code 安全事件`,
        },
        template: color,
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: [
              `**钩子**: ${event.hook}`,
              `**级别**: ${event.severity.toUpperCase()}`,
              `**详情**: ${event.reason}`,
              `**时间**: ${timestamp}`,
            ].join('\n'),
          },
        },
      ],
    },
  };
}

/**
 * 格式化为 Slack 消息
 * @param {{ hook: string, severity: string, reason: string }} event
 * @param {string} timestamp
 * @returns {object}
 */
export function formatSlackMessage(event, timestamp) {
  const emoji = mapSeverityEmoji(event.severity);
  const colorMap = {
    critical: '#FF0000',
    high: '#FF6600',
    medium: '#FFCC00',
    low: '#0066FF',
    info: '#999999',
  };
  const color = colorMap[event.severity] || '#999999';

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} Claude Code 安全事件通知`,
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*钩子*\n${event.hook}` },
              { type: 'mrkdwn', text: `*级别*\n${event.severity.toUpperCase()}` },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*详情*\n${event.reason}` },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `🕐 ${timestamp}` }],
          },
        ],
      },
    ],
  };
}

// ─── Webhook 发送 ────────────────────────────────────────────────────────────

/**
 * 发送 HTTP POST 请求到 Webhook URL
 * @param {string} url - Webhook URL
 * @param {object} body - 请求体
 * @param {number} timeoutMs - 超时时间
 * @returns {Promise<{ success: boolean, status?: number, error?: string }>}
 */
export async function sendWebhook(url, body, timeoutMs) {
  if (timeoutMs === undefined) {
    timeoutMs = parseInt(process.env.NOTIFY_TIMEOUT_MS || '', 10) || 5000;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { success: true, status: response.status };
  } catch (/** @type {any} */ error) {
    if (error.name === 'AbortError') {
      return { success: false, error: `请求超时 (${timeoutMs}ms)` };
    }
    return { success: false, error: error.message || String(error) };
  }
}

// ─── 通知分发 ────────────────────────────────────────────────────────────────

/**
 * 获取所有已配置的 Webhook 渠道
 * @returns {Array<{ name: string, url: string, formatFn: function }>}
 */
export function getConfiguredChannels() {
  const channels = [];

  const wechatUrl = process.env.NOTIFY_WEBHOOK_URL;
  if (wechatUrl) {
    channels.push({ name: '企业微信', url: wechatUrl, formatFn: formatWechatMessage });
  }

  const feishuUrl = process.env.NOTIFY_FEISHU_URL;
  if (feishuUrl) {
    channels.push({ name: '飞书', url: feishuUrl, formatFn: formatFeishuMessage });
  }

  const slackUrl = process.env.NOTIFY_SLACK_URL;
  if (slackUrl) {
    channels.push({ name: 'Slack', url: slackUrl, formatFn: formatSlackMessage });
  }

  return channels;
}

/**
 * 向所有已配置渠道发送通知
 * @param {{ hook: string, severity: string, reason: string }} event
 * @param {string} timestamp
 * @returns {Promise<Array<{ channel: string, success: boolean, error?: string }>>}
 */
export async function notifyAllChannels(event, timestamp) {
  const channels = getConfiguredChannels();
  if (channels.length === 0) return [];

  const results = await Promise.allSettled(
    channels.map(async (ch) => {
      const body = ch.formatFn(event, timestamp);
      const result = await sendWebhook(ch.url, body);
      return { channel: ch.name, ...result };
    }),
  );

  return results.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    return { channel: 'unknown', success: false, error: r.reason?.message || '发送失败' };
  });
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * 处理 Notification 事件
 * @param {object} data - stdin 输入数据
 * @returns {Promise<object>} 处理结果
 */
export async function handleNotification(data) {
  const message = data?.tool_input?.message || '';
  const notificationType = data?.tool_input?.notification_type || '';
  const session_id = data?.session_id || '';

  // 解析事件信息
  const event = parseNotificationMessage(message);
  const eventKey = makeEventKey(event);
  const cooldownMs = parseInt(process.env.NOTIFY_COOLDOWN_MS || '', 10) || DEFAULT_COOLDOWN_MS;

  // 频控检查
  if (isCoolingDown(eventKey, cooldownMs)) {
    log(HOOK_NAME, {
      level: 'SKIP',
      reason: '频控冷却期内',
      eventKey,
      session_id,
    });
    return { sent: false, reason: 'cooldown' };
  }

  // 获取已配置渠道
  const channels = getConfiguredChannels();
  if (channels.length === 0) {
    log(HOOK_NAME, {
      level: 'SKIP',
      reason: '未配置任何 Webhook URL',
      session_id,
    });
    return { sent: false, reason: 'no_channels' };
  }

  // 发送通知
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const results = await notifyAllChannels(event, timestamp);

  // 记录发送时间
  recordSent(eventKey);

  // 记录日志
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  log(HOOK_NAME, {
    level: failCount > 0 ? 'WARN' : 'INFO',
    eventKey,
    notificationType,
    channels: channels.map((c) => c.name),
    success: successCount,
    failed: failCount,
    errors: results.filter((r) => !r.success).map((r) => `${r.channel}: ${r.error}`),
    session_id,
  });

  return { sent: successCount > 0, results };
}

async function main() {
  const data = await readStdin();
  await handleNotification(data);
  // Notification 钩子始终放行（不阻断主流程）
  console.log('{}');
}

// 只在直接运行时执行 main，导入时不执行
if (import.meta.url === `file://${process.argv[1]}`) {
  safeMain(main);
}

export { HOOK_NAME, DEFAULT_COOLDOWN_MS };
