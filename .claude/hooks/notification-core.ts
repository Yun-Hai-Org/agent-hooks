#!/usr/bin/env bun
/**
 * Notification Core - Webhook 通知共享逻辑
 */

import { log } from './security-orchestrator.js';
import type { NotificationChannel, NotificationEvent } from './types.js';

export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

type NotificationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface DispatchInput {
  hook?: string;
  severity?: string;
  reason?: string;
  message?: string;
  session_id?: string;
}

const lastSentMap = new Map<string, number>();

export function isCoolingDown(eventKey: string, cooldownMs = DEFAULT_COOLDOWN_MS): boolean {
  const lastSent = lastSentMap.get(eventKey);
  if (lastSent === undefined) return false;
  return Date.now() - lastSent < cooldownMs;
}

export function recordSent(eventKey: string): void {
  lastSentMap.set(eventKey, Date.now());
}

export function clearCooldownState(): void {
  lastSentMap.clear();
}

const SEVERITY_EMOJI: Record<NotificationSeverity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: 'ℹ️',
};

export function mapSeverityEmoji(severity: string | null | undefined): string {
  if (!severity) return '⚠️';
  const key = severity.toLowerCase() as NotificationSeverity;
  return key in SEVERITY_EMOJI ? SEVERITY_EMOJI[key] : '⚠️';
}

export function parseNotificationMessage(message: string): NotificationEvent {
  if (!message || typeof message !== 'string') {
    return { hook: 'unknown', severity: 'info', reason: typeof message === 'string' ? message : '' };
  }

  const hookMatch = /\[([a-z][a-z0-9-]*)\]/.exec(message);
  const hook = hookMatch?.[1] ?? 'unknown';

  let severity = 'info';
  if (/CRITICAL|致命/i.test(message)) severity = 'critical';
  else if (/HIGH|高危|拦截|阻止|阻断|deny/i.test(message)) severity = 'high';
  else if (/MEDIUM|中等|警告|warn/i.test(message)) severity = 'medium';
  else if (/LOW|低危/i.test(message)) severity = 'low';

  return { hook, severity, reason: message };
}

export function makeEventKey(event: NotificationEvent): string {
  return `${event.hook}:${event.severity}`;
}

export function formatWechatMessage(event: NotificationEvent, timestamp: string): Record<string, unknown> {
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

const FEISHU_COLOR: Record<NotificationSeverity, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'blue',
  info: 'grey',
};

export function formatFeishuMessage(event: NotificationEvent, timestamp: string): Record<string, unknown> {
  const emoji = mapSeverityEmoji(event.severity);
  const severityKey = event.severity.toLowerCase() as NotificationSeverity;
  const color = severityKey in FEISHU_COLOR ? FEISHU_COLOR[severityKey] : 'grey';

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

const SLACK_COLOR: Record<NotificationSeverity, string> = {
  critical: '#FF0000',
  high: '#FF6600',
  medium: '#FFCC00',
  low: '#0066FF',
  info: '#999999',
};

export function formatSlackMessage(event: NotificationEvent, timestamp: string): Record<string, unknown> {
  const emoji = mapSeverityEmoji(event.severity);
  const severityKey = event.severity.toLowerCase() as NotificationSeverity;
  const color = severityKey in SLACK_COLOR ? SLACK_COLOR[severityKey] : '#999999';

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

export async function sendWebhook(url: string, body: Record<string, unknown>, timeoutMs?: number) {
  const resolvedTimeout = timeoutMs ?? (parseInt(process.env['NOTIFY_TIMEOUT_MS'] ?? '', 10) || 5000);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, resolvedTimeout);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, status: response.status, error: `HTTP ${String(response.status)}` };
    }
    return { success: true, status: response.status };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: `请求超时 (${String(resolvedTimeout)}ms)` };
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getConfiguredChannels(): NotificationChannel[] {
  const channels: NotificationChannel[] = [];

  const wechatUrl = process.env['NOTIFY_WEBHOOK_URL'];
  if (wechatUrl) {
    channels.push({ name: '企业微信', url: wechatUrl, formatFn: formatWechatMessage });
  }

  const feishuUrl = process.env['NOTIFY_FEISHU_URL'];
  if (feishuUrl) {
    channels.push({ name: '飞书', url: feishuUrl, formatFn: formatFeishuMessage });
  }

  const slackUrl = process.env['NOTIFY_SLACK_URL'];
  if (slackUrl) {
    channels.push({ name: 'Slack', url: slackUrl, formatFn: formatSlackMessage });
  }

  return channels;
}

export async function notifyAllChannels(event: NotificationEvent, timestamp: string) {
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
    const reason = r.reason instanceof Error ? r.reason.message : '发送失败';
    return { channel: 'unknown', success: false, error: reason };
  });
}

export async function dispatchSecurityNotification(input: DispatchInput, logHookName = 'notify-security-event') {
  const message = input.message ?? input.reason ?? '';
  const event =
    input.hook && input.severity
      ? { hook: input.hook, severity: input.severity, reason: message || (input.reason ?? '') }
      : parseNotificationMessage(message);

  if (input.hook) event.hook = input.hook;
  if (input.severity) event.severity = input.severity;
  if (input.reason && !event.reason) event.reason = input.reason;

  const eventKey = makeEventKey(event);
  const cooldownMs = parseInt(process.env['NOTIFY_COOLDOWN_MS'] ?? '', 10) || DEFAULT_COOLDOWN_MS;
  const session_id = input.session_id ?? '';

  if (isCoolingDown(eventKey, cooldownMs)) {
    log(logHookName, { level: 'SKIP', reason: '频控冷却期内', eventKey, session_id });
    return { sent: false, reason: 'cooldown' };
  }

  const channels = getConfiguredChannels();
  if (channels.length === 0) {
    log(logHookName, { level: 'SKIP', reason: '未配置任何 Webhook URL', session_id, eventKey });
    return { sent: false, reason: 'no_channels' };
  }

  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const results = await notifyAllChannels(event, timestamp);
  recordSent(eventKey);

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  log(logHookName, {
    level: failCount > 0 ? 'WARN' : 'INFO',
    eventKey,
    channels: channels.map((c) => c.name),
    success: successCount,
    failed: failCount,
    session_id,
  });

  return { sent: successCount > 0, results, reason: successCount > 0 ? undefined : 'send_failed' };
}
