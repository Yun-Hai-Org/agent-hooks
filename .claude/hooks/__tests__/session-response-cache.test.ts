import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync } from 'fs';
import {
  clearSessionResponse,
  getSessionResponseCachePath,
  handleSessionResponseCache,
  readSessionResponse,
  writeSessionResponse,
} from '../session-response-cache.js';

describe('session-response-cache', () => {
  const sessionId = 'cache-unit-test-session';

  afterEach(() => {
    clearSessionResponse(sessionId);
    clearSessionResponse('');
  });

  it('getSessionResponseCachePath 应包含 sessionId', () => {
    expect(getSessionResponseCachePath(sessionId)).toContain(`${sessionId}.json`);
  });

  it('空 sessionId 或空文本时不写入', () => {
    writeSessionResponse('', 'text');
    writeSessionResponse(sessionId, '   ');
    expect(readSessionResponse(sessionId)).toBe('');
  });

  it('handleSessionResponseCache 应缓存 Stop 事件摘要', () => {
    handleSessionResponseCache({
      hook_event_name: 'Stop',
      session_id: sessionId,
      last_assistant_message: 'assistant summary',
      cwd: process.cwd(),
    });
    expect(readSessionResponse(sessionId)).toBe('assistant summary');
  });

  it('handleSessionResponseCache 应忽略非缓存事件', () => {
    handleSessionResponseCache({
      hook_event_name: 'beforeSubmitPrompt',
      session_id: sessionId,
      text: 'ignored',
      cwd: process.cwd(),
    });
    expect(readSessionResponse(sessionId)).toBe('');
  });

  it('readSessionResponse 遇到损坏 JSON 时返回空字符串', () => {
    writeSessionResponse(sessionId, 'ok');
    const path = getSessionResponseCachePath(sessionId);
    if (existsSync(path)) {
      Bun.write(path, '{not-json');
    }
    expect(readSessionResponse(sessionId)).toBe('');
  });
});
