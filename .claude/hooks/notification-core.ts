#!/usr/bin/env bun
/**
 * Notification Core - Webhook 通知共享逻辑
 */

import { getNotificationSettings } from './gate-config.js';
import { getPlatform, platformLabel } from './hook-adapter.js';
import { log } from './security-orchestrator.js';
import type { NotificationChannel, NotificationEvent } from './types.js';
import type { GitOperationKind } from './gate-config.js';
import { basename } from 'path';

export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

type NotificationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface DispatchInput {
  hook?: string;
  severity?: string;
  reason?: string;
  message?: string;
  session_id?: string;
  cwd?: string;
}

export interface ConversationEndEvent {
  platform: string;
  projectName: string;
  sessionId: string;
  summaryText: string;
  reason?: string;
  durationMs?: number;
  status?: string;
  uncommittedHint?: string;
}

export interface GitOperationEvent {
  operation: GitOperationKind;
  projectName: string;
  platform: string;
  branch: string;
  summaryText: string;
  commitSha?: string;
}

export function conversationEndTitle(status?: string): string {
  if (status === 'error' || status === 'aborted') return '⚠️ **对话异常结束**';
  if (status === 'completed' || !status) return '✅ **对话结束通知**';
  return 'ℹ️ **对话结束通知**';
}

function resolveSecurityProjectName(cwd: string): string {
  return basename(cwd) || 'project';
}

function resolveSecurityPlatform(): string {
  return platformLabel(getPlatform());
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

export function securityEventTitle(severity: string): string {
  return `${mapSeverityEmoji(severity)} **安全事件通知**`;
}

export function gitOperationTitle(operation: GitOperationKind): string {
  switch (operation) {
    case 'commit':
      return '✅ **Git 提交通知**';
    case 'push':
      return '✅ **Git 推送通知**';
    case 'merge':
      return '✅ **Git 合并通知**';
    default: {
      const _exhaustive: never = operation;
      return _exhaustive;
    }
  }
}

function makeGitOperationEventKey(operation: GitOperationKind, commitSha: string): string {
  return `git-operation:${operation}:${commitSha || 'unknown'}`;
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

export function truncateSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function formatWechatMessage(event: NotificationEvent, timestamp: string): Record<string, unknown> {
  const lines = [
    securityEventTitle(event.severity),
    '',
    `> **项目**: ${event.projectName ?? 'unknown'}`,
    `> **平台**: ${event.platform ?? 'unknown'}`,
    `> **钩子**: ${event.hook}`,
    `> **级别**: ${event.severity.toUpperCase()}`,
  ];
  if (event.sessionId) lines.push(`> **会话**: ${event.sessionId}`);
  lines.push(`> **时间**: ${timestamp}`, '', '**详情**', event.reason);
  return { msgtype: 'markdown', markdown: { content: lines.join('\n') } };
}

export function formatWechatGitOperationMessage(
  event: GitOperationEvent,
  timestamp: string,
  maxSummaryChars: number,
): Record<string, unknown> {
  const summary = truncateSummary(event.summaryText || '(无说明)', maxSummaryChars);
  const lines = [
    gitOperationTitle(event.operation),
    '',
    `> **项目**: ${event.projectName}`,
    `> **平台**: ${event.platform}`,
    `> **分支**: ${event.branch}`,
  ];
  if (event.commitSha) lines.push(`> **提交**: ${event.commitSha.slice(0, 7)}`);
  lines.push(`> **时间**: ${timestamp}`, '', '**说明**', summary);
  return { msgtype: 'markdown', markdown: { content: lines.join('\n') } };
}

export function formatWechatConversationEndMessage(
  event: ConversationEndEvent,
  timestamp: string,
  maxSummaryChars: number,
): Record<string, unknown> {
  const summary = truncateSummary(event.summaryText || '(无摘要)', maxSummaryChars);
  const lines = [
    conversationEndTitle(event.status),
    '',
    `> **项目**: ${event.projectName}`,
    `> **平台**: ${event.platform}`,
    `> **会话**: ${event.sessionId || 'unknown'}`,
  ];
  if (event.reason) lines.push(`> **原因**: ${event.reason}`);
  if (event.status) lines.push(`> **状态**: ${event.status}`);
  if (event.durationMs !== undefined) lines.push(`> **时长**: ${String(Math.round(event.durationMs / 1000))}s`);
  lines.push(`> **时间**: ${timestamp}`, '', '**摘要**', summary);
  if (event.uncommittedHint) {
    lines.push('', '**提示**', event.uncommittedHint);
  }
  return { msgtype: 'markdown', markdown: { content: lines.join('\n') } };
}

const FEISHU_COLOR: Record<NotificationSeverity, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'blue',
  info: 'grey',
};

export function formatFeishuMessage(event: NotificationEvent, timestamp: string): Record<string, unknown> {
  const severityKey = event.severity.toLowerCase() as NotificationSeverity;
  const color = severityKey in FEISHU_COLOR ? FEISHU_COLOR[severityKey] : 'grey';
  const meta = [
    `**项目**: ${event.projectName ?? 'unknown'}`,
    `**平台**: ${event.platform ?? 'unknown'}`,
    `**钩子**: ${event.hook}`,
    `**级别**: ${event.severity.toUpperCase()}`,
    event.sessionId ? `**会话**: ${event.sessionId}` : '',
    `**时间**: ${timestamp}`,
  ]
    .filter(Boolean)
    .join('\n');
  const titlePlain = securityEventTitle(event.severity).replace(/\*\*/g, '');

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: titlePlain },
        template: color,
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: meta } },
        { tag: 'div', text: { tag: 'lark_md', content: `**详情**\n${event.reason}` } },
      ],
    },
  };
}

export function formatFeishuGitOperationMessage(
  event: GitOperationEvent,
  timestamp: string,
  maxSummaryChars: number,
): Record<string, unknown> {
  const summary = truncateSummary(event.summaryText || '(无说明)', maxSummaryChars);
  const meta = [
    `**项目**: ${event.projectName}`,
    `**平台**: ${event.platform}`,
    `**分支**: ${event.branch}`,
    event.commitSha ? `**提交**: ${event.commitSha.slice(0, 7)}` : '',
    `**时间**: ${timestamp}`,
  ]
    .filter(Boolean)
    .join('\n');
  const titlePlain = gitOperationTitle(event.operation).replace(/\*\*/g, '');
  return {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: titlePlain }, template: 'green' },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: meta } },
        { tag: 'div', text: { tag: 'lark_md', content: `**说明**\n${summary}` } },
      ],
    },
  };
}

export function formatFeishuConversationEndMessage(
  event: ConversationEndEvent,
  timestamp: string,
  maxSummaryChars: number,
): Record<string, unknown> {
  const summary = truncateSummary(event.summaryText || '(无摘要)', maxSummaryChars);
  const meta = [
    `**项目**: ${event.projectName}`,
    `**平台**: ${event.platform}`,
    `**会话**: ${event.sessionId || 'unknown'}`,
    event.reason ? `**原因**: ${event.reason}` : '',
    event.status ? `**状态**: ${event.status}` : '',
    event.durationMs !== undefined ? `**时长**: ${String(Math.round(event.durationMs / 1000))}s` : '',
    `**时间**: ${timestamp}`,
  ]
    .filter(Boolean)
    .join('\n');
  const elements: { tag: string; text: { tag: string; content: string } }[] = [
    { tag: 'div', text: { tag: 'lark_md', content: meta } },
    { tag: 'div', text: { tag: 'lark_md', content: `**摘要**\n${summary}` } },
  ];
  if (event.uncommittedHint) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**提示**\n${event.uncommittedHint}` } });
  }
  const titlePlain = conversationEndTitle(event.status).replace(/\*\*/g, '');
  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: titlePlain },
        template: event.status === 'error' || event.status === 'aborted' ? 'orange' : 'green',
      },
      elements,
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
  const severityKey = event.severity.toLowerCase() as NotificationSeverity;
  const color = severityKey in SLACK_COLOR ? SLACK_COLOR[severityKey] : '#999999';
  const titlePlain = securityEventTitle(event.severity).replace(/\*\*/g, '');
  const fields = [
    { type: 'mrkdwn', text: `*项目*\n${event.projectName ?? 'unknown'}` },
    { type: 'mrkdwn', text: `*平台*\n${event.platform ?? 'unknown'}` },
    { type: 'mrkdwn', text: `*钩子*\n${event.hook}` },
    { type: 'mrkdwn', text: `*级别*\n${event.severity.toUpperCase()}` },
  ];

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: titlePlain, emoji: true },
          },
          { type: 'section', fields },
          { type: 'section', text: { type: 'mrkdwn', text: `*详情*\n${event.reason}` } },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `🕐 ${timestamp}` }],
          },
        ],
      },
    ],
  };
}

export function formatSlackGitOperationMessage(
  event: GitOperationEvent,
  timestamp: string,
  maxSummaryChars: number,
): Record<string, unknown> {
  const summary = truncateSummary(event.summaryText || '(无说明)', maxSummaryChars);
  const titlePlain = gitOperationTitle(event.operation).replace(/\*\*/g, '');
  const fields = [
    { type: 'mrkdwn', text: `*项目*\n${event.projectName}` },
    { type: 'mrkdwn', text: `*平台*\n${event.platform}` },
    { type: 'mrkdwn', text: `*分支*\n${event.branch}` },
  ];
  if (event.commitSha) fields.push({ type: 'mrkdwn', text: `*提交*\n${event.commitSha.slice(0, 7)}` });
  return {
    attachments: [
      {
        color: '#2EB886',
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: titlePlain, emoji: true } },
          { type: 'section', fields },
          { type: 'section', text: { type: 'mrkdwn', text: `*说明*\n${summary}` } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `🕐 ${timestamp}` }] },
        ],
      },
    ],
  };
}

export function formatSlackConversationEndMessage(
  event: ConversationEndEvent,
  timestamp: string,
  maxSummaryChars: number,
): Record<string, unknown> {
  const summary = truncateSummary(event.summaryText || '(无摘要)', maxSummaryChars);
  const fields = [
    { type: 'mrkdwn', text: `*项目*\n${event.projectName}` },
    { type: 'mrkdwn', text: `*平台*\n${event.platform}` },
  ];
  if (event.status) fields.push({ type: 'mrkdwn', text: `*状态*\n${event.status}` });
  const titlePlain = conversationEndTitle(event.status).replace(/\*\*/g, '');
  const color = event.status === 'error' || event.status === 'aborted' ? '#ECB22E' : '#2EB886';
  const blocks: Record<string, unknown>[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: titlePlain, emoji: true },
    },
    { type: 'section', fields },
    { type: 'section', text: { type: 'mrkdwn', text: `*摘要*\n${summary}` } },
  ];
  if (event.uncommittedHint) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*提示*\n${event.uncommittedHint}` } });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `🕐 ${timestamp}` }],
  });
  return {
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };
}

export async function sendWebhook(url: string, body: Record<string, unknown>, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

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
      return { success: false, error: `请求超时 (${String(timeoutMs)}ms)` };
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getConfiguredChannels(cwd: string): NotificationChannel[] {
  const { channels } = getNotificationSettings(cwd);
  const result: NotificationChannel[] = [];
  if (channels.wechat) {
    result.push({ name: '企业微信', url: channels.wechat, formatFn: formatWechatMessage });
  }
  if (channels.feishu) {
    result.push({ name: '飞书', url: channels.feishu, formatFn: formatFeishuMessage });
  }
  if (channels.slack) {
    result.push({ name: 'Slack', url: channels.slack, formatFn: formatSlackMessage });
  }
  return result;
}

export async function notifyAllChannels(event: NotificationEvent, timestamp: string, cwd: string) {
  const channels = getConfiguredChannels(cwd);
  if (channels.length === 0) return [];

  const { timeoutMs } = getNotificationSettings(cwd);
  const results = await Promise.allSettled(
    channels.map(async (ch) => {
      const body = ch.formatFn(event, timestamp);
      const result = await sendWebhook(ch.url, body, timeoutMs);
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
  const cwd = input.cwd ?? process.cwd();
  const message = input.message ?? input.reason ?? '';
  const event =
    input.hook && input.severity
      ? { hook: input.hook, severity: input.severity, reason: message || (input.reason ?? '') }
      : parseNotificationMessage(message);

  if (input.hook) event.hook = input.hook;
  if (input.severity) event.severity = input.severity;
  if (input.reason && !event.reason) event.reason = input.reason;

  event.projectName = resolveSecurityProjectName(cwd);
  event.platform = resolveSecurityPlatform();
  if (input.session_id) event.sessionId = input.session_id;

  const eventKey = makeEventKey(event);
  const { cooldownMs } = getNotificationSettings(cwd);
  const session_id = input.session_id ?? '';

  if (isCoolingDown(eventKey, cooldownMs)) {
    log(logHookName, { level: 'SKIP', reason: '频控冷却期内', eventKey, session_id });
    return { sent: false, reason: 'cooldown' };
  }

  const channels = getConfiguredChannels(cwd);
  if (channels.length === 0) {
    log(logHookName, { level: 'SKIP', reason: '未配置任何 Webhook URL', session_id, eventKey });
    return { sent: false, reason: 'no_channels' };
  }

  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const results = await notifyAllChannels(event, timestamp, cwd);
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

export async function dispatchGitOperationNotification(
  event: GitOperationEvent,
  cwd: string,
  options: { maxSummaryChars?: number; timeoutMs?: number } = {},
  logHookName = 'git-operation-notify',
) {
  const settings = getNotificationSettings(cwd);
  const maxSummaryChars = options.maxSummaryChars ?? 1500;
  const timeoutMs = options.timeoutMs ?? settings.timeoutMs;
  const eventKey = makeGitOperationEventKey(event.operation, event.commitSha ?? event.branch);

  if (isCoolingDown(eventKey, settings.cooldownMs)) {
    log(logHookName, { level: 'SKIP', reason: '频控冷却期内', eventKey, operation: event.operation });
    return { sent: false, reason: 'cooldown' };
  }

  const timestamp = timestampForNotify();
  const urls = settings.channels;
  const targets: { name: string; url: string; format: (ts: string) => Record<string, unknown> }[] = [];
  if (urls.wechat) {
    targets.push({
      name: '企业微信',
      url: urls.wechat,
      format: (ts) => formatWechatGitOperationMessage(event, ts, maxSummaryChars),
    });
  }
  if (urls.feishu) {
    targets.push({
      name: '飞书',
      url: urls.feishu,
      format: (ts) => formatFeishuGitOperationMessage(event, ts, maxSummaryChars),
    });
  }
  if (urls.slack) {
    targets.push({
      name: 'Slack',
      url: urls.slack,
      format: (ts) => formatSlackGitOperationMessage(event, ts, maxSummaryChars),
    });
  }

  if (targets.length === 0) {
    log(logHookName, { level: 'SKIP', reason: '未配置任何 Webhook URL', operation: event.operation, eventKey });
    return { sent: false, reason: 'no_channels' };
  }

  const results = await Promise.allSettled(
    targets.map(async (ch) => {
      const body = ch.format(timestamp);
      const result = await sendWebhook(ch.url, body, timeoutMs);
      return { channel: ch.name, ...result };
    }),
  );

  const mapped = results.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    const reason = r.reason instanceof Error ? r.reason.message : '发送失败';
    return { channel: 'unknown', success: false, error: reason };
  });

  recordSent(eventKey);
  const successCount = mapped.filter((r) => r.success).length;
  const failCount = mapped.filter((r) => !r.success).length;
  log(logHookName, {
    level: failCount > 0 ? 'WARN' : 'INFO',
    eventKey,
    operation: event.operation,
    channels: targets.map((c) => c.name),
    success: successCount,
    failed: failCount,
    project: event.projectName,
    branch: event.branch,
  });

  return { sent: successCount > 0, results: mapped, reason: successCount > 0 ? undefined : 'send_failed' };
}

function makeConversationEndEventKey(sessionId: string): string {
  return `conversation-end:${sessionId || 'unknown'}`;
}

export async function dispatchConversationEndNotification(
  event: ConversationEndEvent,
  cwd: string,
  options: { maxSummaryChars?: number; timeoutMs?: number } = {},
  logHookName = 'session-end-notify',
) {
  const settings = getNotificationSettings(cwd);
  const maxSummaryChars = options.maxSummaryChars ?? 1500;
  const timeoutMs = options.timeoutMs ?? settings.timeoutMs;
  const eventKey = makeConversationEndEventKey(event.sessionId);

  if (isCoolingDown(eventKey, settings.cooldownMs)) {
    log(logHookName, { level: 'SKIP', reason: '频控冷却期内', eventKey, session_id: event.sessionId });
    return { sent: false, reason: 'cooldown' };
  }

  const timestamp = timestampForNotify();
  const urls = settings.channels;
  const targets: { name: string; url: string; format: (ts: string) => Record<string, unknown> }[] = [];
  if (urls.wechat) {
    targets.push({
      name: '企业微信',
      url: urls.wechat,
      format: (ts) => formatWechatConversationEndMessage(event, ts, maxSummaryChars),
    });
  }
  if (urls.feishu) {
    targets.push({
      name: '飞书',
      url: urls.feishu,
      format: (ts) => formatFeishuConversationEndMessage(event, ts, maxSummaryChars),
    });
  }
  if (urls.slack) {
    targets.push({
      name: 'Slack',
      url: urls.slack,
      format: (ts) => formatSlackConversationEndMessage(event, ts, maxSummaryChars),
    });
  }

  if (targets.length === 0) {
    log(logHookName, { level: 'SKIP', reason: '未配置任何 Webhook URL', session_id: event.sessionId, eventKey });
    return { sent: false, reason: 'no_channels' };
  }

  const results = await Promise.allSettled(
    targets.map(async (ch) => {
      const body = ch.format(timestamp);
      const result = await sendWebhook(ch.url, body, timeoutMs);
      return { channel: ch.name, ...result };
    }),
  );

  const mapped = results.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    const reason = r.reason instanceof Error ? r.reason.message : '发送失败';
    return { channel: 'unknown', success: false, error: reason };
  });

  recordSent(eventKey);
  const successCount = mapped.filter((r) => r.success).length;
  const failCount = mapped.filter((r) => !r.success).length;
  log(logHookName, {
    level: failCount > 0 ? 'WARN' : 'INFO',
    eventKey,
    channels: targets.map((c) => c.name),
    success: successCount,
    failed: failCount,
    session_id: event.sessionId,
    platform: event.platform,
    project: event.projectName,
  });

  return { sent: successCount > 0, results: mapped, reason: successCount > 0 ? undefined : 'send_failed' };
}

function timestampForNotify(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
