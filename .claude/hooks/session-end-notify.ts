#!/usr/bin/env bun
/**
 * Session End Notify - 三端对话结束企业微信/飞书/Slack 通知
 */

import { existsSync, readFileSync } from 'fs';
import { getSessionEndNotifyConfig } from './gate-config.js';
import { GENERIC_GITIGNORE_HINT, hasUncommittedChanges } from './checks/git-policy.js';
import {
  isSessionEndHookEvent,
  parseConversationEndInput,
  platformLabel,
  shouldNotifyForTrigger,
  type ConversationEndInput,
} from './hook-adapter.js';
import { dispatchConversationEndNotification } from './notification-core.js';
import { readSessionResponse, clearSessionResponse } from './session-response-cache.js';
import { log, readStdin, safeMain } from './security-orchestrator.js';

const HOOK_NAME = 'session-end-notify';

function extractTextFromTranscriptLine(parsed: Record<string, unknown>): string {
  const message = parsed['message'];
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>)['content'];
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (block && typeof block === 'object' && 'text' in block) {
            const textVal = (block as Record<string, unknown>)['text'];
            return typeof textVal === 'string' ? textVal : '';
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
  }
  if (typeof parsed['text'] === 'string') return parsed['text'];
  return '';
}

export function extractLastAssistantFromTranscript(transcriptPath: string): string {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  try {
    const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line?.trim()) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const typeRaw = parsed['type'] ?? parsed['role'];
      const type = typeof typeRaw === 'string' ? typeRaw.toLowerCase() : '';
      if (type === 'assistant') {
        const text = extractTextFromTranscriptLine(parsed);
        if (text) return text;
      }
    }
  } catch {
    return '';
  }
  return '';
}

export function resolveSummaryText(input: ConversationEndInput): string {
  if (input.summaryText.trim()) return input.summaryText.trim();
  const cached = readSessionResponse(input.sessionId);
  if (cached.trim()) return cached.trim();
  if (input.transcriptPath && isSessionEndHookEvent(input.hookEvent)) {
    return extractLastAssistantFromTranscript(input.transcriptPath);
  }
  return '';
}

export function buildFallbackSummaryText(input: ConversationEndInput): string {
  const sessionShort = input.sessionId ? input.sessionId.slice(0, 8) : 'unknown';
  const status = input.status ?? 'completed';
  const duration =
    input.durationMs !== undefined ? `，时长 ${String(Math.round(input.durationMs / 1000))}s` : '';
  return `对话已结束（无可用摘要）。项目 ${input.projectName}，会话 ${sessionShort}，状态 ${status}${duration}。`;
}

export function shouldSendSessionEndNotify(input: ConversationEndInput, platformTrigger: string): boolean {
  return shouldNotifyForTrigger(platformTrigger as 'session_end' | 'stop' | 'both', input.hookEvent);
}

export async function handleSessionEndNotify(data: Record<string, unknown>) {
  const input = parseConversationEndInput(data);
  const config = getSessionEndNotifyConfig(input.cwd, input.platform);
  if (!config.enabled) {
    return { sent: false, reason: 'gate disabled' };
  }
  if (!shouldSendSessionEndNotify(input, config.platformTrigger)) {
    log(HOOK_NAME, {
      level: 'SKIP',
      reason: 'trigger_filtered',
      hook_event: input.hookEvent,
      status: input.status,
      session_id: input.sessionId,
    });
    return { sent: false, reason: 'trigger_filtered' };
  }
  const summaryText = resolveSummaryText(input);
  let effectiveSummary = summaryText;
  let summarySource: 'resolved' | 'fallback' = 'resolved';
  if (!effectiveSummary) {
    if (!config.fallbackOnEmptySummary) {
      log(HOOK_NAME, { level: 'SKIP', reason: 'empty summary', session_id: input.sessionId });
      return { sent: false, reason: 'empty_summary' };
    }
    effectiveSummary = buildFallbackSummaryText(input);
    summarySource = 'fallback';
  }
  const uncommittedHint = hasUncommittedChanges(input.cwd) ? GENERIC_GITIGNORE_HINT : undefined;
  const result = await dispatchConversationEndNotification(
    {
      platform: platformLabel(input.platform),
      projectName: input.projectName,
      sessionId: input.sessionId,
      summaryText: effectiveSummary,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(uncommittedHint !== undefined ? { uncommittedHint } : {}),
    },
    input.cwd,
    { maxSummaryChars: config.maxSummaryChars, timeoutMs: config.timeoutMs },
    HOOK_NAME,
  );
  if (summarySource === 'fallback') {
    log(HOOK_NAME, {
      level: result.sent ? 'INFO' : 'SKIP',
      reason: 'fallback_summary',
      session_id: input.sessionId,
      sent: result.sent,
    });
  }
  if (result.sent && input.sessionId) {
    clearSessionResponse(input.sessionId);
  }
  return result;
}

async function main() {
  try {
    const data = await readStdin();
    await handleSessionEndNotify(data);
  } catch {
    // fail-open
  }
  process.stdout.write('{}\n');
}

if (import.meta.main) {
  void safeMain(main);
}

export { HOOK_NAME };
