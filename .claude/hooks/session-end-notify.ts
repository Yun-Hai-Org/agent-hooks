#!/usr/bin/env bun
/**
 * Session End Notify - 三端对话结束企业微信/飞书/Slack 通知
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import { getSessionEndNotifyConfig } from './gate-config.js';
import { GENERIC_GITIGNORE_HINT, hasUncommittedChanges } from './checks/git-policy.js';
import {
  isSessionEndHookEvent,
  isStopHookEvent,
  parseConversationEndInput,
  platformLabel,
  shouldNotifyForTrigger,
  type ConversationEndInput,
} from './hook-adapter.js';
import { dispatchConversationEndNotification } from './notification-core.js';
import { readSessionResponse, clearSessionResponse } from './session-response-cache.js';
import { log, readStdin, safeMain } from './security-orchestrator.js';

const HOOK_NAME = 'session-end-notify';
const REDACTED_TOKEN = '[REDACTED]';

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
    if (typeof content === 'string') return content;
  }
  if (typeof parsed['text'] === 'string') return parsed['text'];
  return '';
}

/** Cursor agent transcripts often append or replace body with [REDACTED]. */
export function sanitizeSummaryText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed === REDACTED_TOKEN) return '';
  return trimmed
    .replace(/\n*\[REDACTED\]\s*$/g, '')
    .replace(/\[REDACTED\]/g, '')
    .trim();
}

/** Cursor may pass a session directory; Claude may pass a .jsonl file. */
export function resolveTranscriptFilePath(transcriptPath: string): string {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  try {
    const st = statSync(transcriptPath);
    if (st.isFile()) return transcriptPath;
    if (!st.isDirectory()) return '';
    const preferred = join(transcriptPath, `${basename(transcriptPath)}.jsonl`);
    if (existsSync(preferred) && statSync(preferred).isFile()) return preferred;
    const jsonl = readdirSync(transcriptPath)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(transcriptPath, name))
      .find((path) => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      });
    return jsonl ?? '';
  } catch {
    return '';
  }
}

function shouldReadTranscript(hookEvent: string): boolean {
  return isSessionEndHookEvent(hookEvent) || isStopHookEvent(hookEvent);
}

export function extractLastAssistantFromTranscript(transcriptPath: string): string {
  const filePath = resolveTranscriptFilePath(transcriptPath);
  if (!filePath) return '';
  try {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line?.trim()) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const typeRaw = parsed['type'] ?? parsed['role'];
      const type = typeof typeRaw === 'string' ? typeRaw.toLowerCase() : '';
      if (type === 'assistant') {
        const text = sanitizeSummaryText(extractTextFromTranscriptLine(parsed));
        if (text) return text;
      }
    }
  } catch {
    return '';
  }
  return '';
}

export function resolveSummaryText(input: ConversationEndInput): string {
  return resolveSummaryTextWithSource(input).text;
}

export function resolveSummaryTextWithSource(input: ConversationEndInput): {
  text: string;
  source: 'inline' | 'cache' | 'transcript' | 'empty';
  cacheHit: boolean;
  cacheLen: number;
} {
  const inline = sanitizeSummaryText(input.summaryText);
  if (inline) {
    return { text: inline, source: 'inline', cacheHit: false, cacheLen: 0 };
  }
  const cached = sanitizeSummaryText(readSessionResponse(input.sessionId));
  if (cached) {
    return { text: cached, source: 'cache', cacheHit: true, cacheLen: cached.length };
  }
  if (input.transcriptPath && shouldReadTranscript(input.hookEvent)) {
    const fromTranscript = extractLastAssistantFromTranscript(input.transcriptPath);
    if (fromTranscript) {
      return {
        text: fromTranscript,
        source: 'transcript',
        cacheHit: false,
        cacheLen: 0,
      };
    }
  }
  return { text: '', source: 'empty', cacheHit: false, cacheLen: 0 };
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
  const agent_id = typeof data['agent_id'] === 'string' ? data['agent_id'] : '';
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
  const resolved = resolveSummaryTextWithSource(input);
  let effectiveSummary = resolved.text;
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
      ...(agent_id ? { agent_id } : {}),
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
