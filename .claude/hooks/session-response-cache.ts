#!/usr/bin/env bun
/**
 * Session Response Cache - 缓存 Agent 最后一轮回复，供 session-end-notify 读取
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { readStdin, safeMain } from './security-orchestrator.js';
import { extractAssistantText, getPlatform, isStopHookEvent, parseConversationEndInput } from './hook-adapter.js';

const HOOK_NAME = 'session-response-cache';
const CACHE_DIR = join(homedir(), '.claude', 'cache', 'session-responses');

interface CachedSessionResponse {
  text: string;
  ts: number;
}

export function getSessionResponseCachePath(sessionId: string): string {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- CACHE_DIR 为常量，sessionId 来自 IDE hook 会话标识
  return join(CACHE_DIR, `${sessionId}.json`);
}

export function writeSessionResponse(sessionId: string, text: string): void {
  if (!sessionId || !text.trim()) return;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const payload: CachedSessionResponse = { text, ts: Date.now() };
    writeFileSync(getSessionResponseCachePath(sessionId), JSON.stringify(payload), 'utf-8');
  } catch {
    // fail-open
  }
}

export function readSessionResponse(sessionId: string): string {
  if (!sessionId) return '';
  try {
    const path = getSessionResponseCachePath(sessionId);
    if (!existsSync(path)) return '';
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as CachedSessionResponse;
    return typeof parsed.text === 'string' ? parsed.text : '';
  } catch {
    return '';
  }
}

export function clearSessionResponse(sessionId: string): void {
  if (!sessionId) return;
  try {
    const path = getSessionResponseCachePath(sessionId);
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // fail-open
  }
}

function shouldCacheResponse(hookEvent: string): boolean {
  const normalized = hookEvent.replace(/_/g, '').toLowerCase();
  return normalized === 'afteragentresponse' || isStopHookEvent(hookEvent);
}

export function handleSessionResponseCache(data: Record<string, unknown>): void {
  const parsed = parseConversationEndInput(data);
  if (!shouldCacheResponse(parsed.hookEvent)) return;
  const text = parsed.summaryText || extractAssistantText(data, parsed.platform, parsed.hookEvent);
  if (!text.trim() || !parsed.sessionId) return;
  writeSessionResponse(parsed.sessionId, text);
}

async function main() {
  try {
    const data = await readStdin();
    if (getPlatform() === 'cursor' && !data['hook_event_name']) {
      const text = typeof data['text'] === 'string' ? data['text'] : '';
      const sessionId =
        typeof data['conversation_id'] === 'string'
          ? data['conversation_id']
          : typeof data['session_id'] === 'string'
            ? data['session_id']
            : '';
      if (text && sessionId) writeSessionResponse(sessionId, text);
    } else {
      handleSessionResponseCache(data);
    }
  } catch {
    // fail-open
  }
  process.stdout.write('{}\n');
}

if (import.meta.main) {
  void safeMain(main);
}

export { HOOK_NAME };
