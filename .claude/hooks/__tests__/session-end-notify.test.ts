import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  clearGateConfigCache,
  getEffectiveSessionEndTrigger,
  getNotificationSettings,
  getSessionEndNotifyConfig,
  resolvePlatformSessionEndTrigger,
} from '../gate-config.js';
import {
  formatTriggerLabel,
  isSessionEndHookEvent,
  isStopHookEvent,
  parseConversationEndInput,
  shouldNotifyForTrigger,
} from '../hook-adapter.js';
import { clearSessionResponse, readSessionResponse, writeSessionResponse } from '../session-response-cache.js';
import {
  formatWechatConversationEndMessage,
  truncateSummary,
  clearCooldownState,
  conversationEndTitle,
  type ConversationEndEvent,
} from '../notification-core.js';
import { buildUncommittedWorktreeDenyReason, GENERIC_GITIGNORE_HINT } from '../checks/git-policy.js';
import {
  extractLastAssistantFromTranscript,
  handleSessionEndNotify,
  resolveSummaryText,
  buildFallbackSummaryText,
} from '../session-end-notify.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

function writeNotifyYaml(repoDir: string, overrides?: { maxSummaryChars?: number; triggerBlock?: string }) {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- repoDir 为受信临时测试仓库根
  mkdirSync(join(repoDir, '.claude'), { recursive: true });
  const maxSummaryChars = overrides?.maxSummaryChars ?? 1500;
  const triggerBlock =
    overrides?.triggerBlock ??
    `    trigger: both
    maxSummaryChars: ${String(maxSummaryChars)}
    timeout: 5s
    platforms:
      cursor:
        trigger: both
      claude:
        trigger: both
      kiro:
        trigger: both`;
  writeFileSync(
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- repoDir 为受信临时测试仓库根
    join(repoDir, '.claude/quality-gate.yaml'),
    `settings:
  notifications:
    timeout: 5s
    cooldown: 5m
    channels:
      wechat:
        url: ""
ide:
  session-end-notify:
    enabled: true
${triggerBlock}
`,
  );
  clearGateConfigCache();
}

describe('session-end-notify', () => {
  let repoDir: string;
  const prevPlatform = process.env.HOOK_PLATFORM;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/session-end-notify');
    clearGateConfigCache();
    clearCooldownState();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
    clearCooldownState();
    if (prevPlatform === undefined) delete process.env.HOOK_PLATFORM;
    else process.env.HOOK_PLATFORM = prevPlatform;
  });

  describe('hook-adapter', () => {
    it('Cursor afterAgentResponse 应解析 text', () => {
      process.env.HOOK_PLATFORM = 'cursor';
      const parsed = parseConversationEndInput({
        hook_event_name: 'afterAgentResponse',
        conversation_id: 'c1',
        text: '完成总结',
        workspace_roots: [join(repoDir, 'my-project')],
        cwd: repoDir,
      });
      expect(parsed.summaryText).toBe('完成总结');
      expect(parsed.projectName).toBe('my-project');
    });

    it('Claude Stop 应解析 last_assistant_message', () => {
      process.env.HOOK_PLATFORM = 'claude';
      const parsed = parseConversationEndInput({
        hook_event_name: 'Stop',
        session_id: 's1',
        last_assistant_message: 'Claude 回复',
        cwd: repoDir,
      });
      expect(parsed.summaryText).toBe('Claude 回复');
    });

    it('Kiro Stop 应解析 assistant_response', () => {
      process.env.HOOK_PLATFORM = 'kiro';
      const parsed = parseConversationEndInput({
        hook_event_name: 'Stop',
        session_id: 'k1',
        assistant_response: 'Kiro 回复',
        cwd: repoDir,
      });
      expect(parsed.summaryText).toBe('Kiro 回复');
    });

    it('shouldNotifyForTrigger 应区分 sessionEnd 与 stop', () => {
      expect(shouldNotifyForTrigger('session_end', 'SessionEnd')).toBe(true);
      expect(shouldNotifyForTrigger('session_end', 'Stop')).toBe(false);
      expect(shouldNotifyForTrigger('stop', 'Stop')).toBe(true);
      expect(shouldNotifyForTrigger('both', 'SessionEnd')).toBe(true);
      expect(isSessionEndHookEvent('SessionEnd')).toBe(true);
      expect(isStopHookEvent('Stop')).toBe(true);
    });
  });

  describe('gate-config', () => {
    it('Kiro session_end 应降级为 stop', () => {
      writeNotifyYaml(repoDir, {
        triggerBlock: `    trigger: session_end
    maxSummaryChars: 1500
    timeout: 5s
    platforms:
      cursor:
        trigger: session_end
      claude:
        trigger: session_end
      kiro:
        trigger: stop`,
      });
      expect(getEffectiveSessionEndTrigger('kiro', repoDir)).toBe('stop');
      expect(resolvePlatformSessionEndTrigger('session_end', 'kiro')).toBe('stop');
      expect(formatTriggerLabel('stop', 'kiro')).toContain('Kiro 无 sessionEnd');
    });

    it('getSessionEndNotifyConfig 应读取 maxSummaryChars', () => {
      mkdirSync(join(repoDir, '.claude'), { recursive: true });
      writeFileSync(
        join(repoDir, '.claude/quality-gate.yaml'),
        `settings:
  notifications:
    channels:
      wechat:
        url: ""
ide:
  session-end-notify:
    enabled: true
    trigger: session_end
    maxSummaryChars: 800
    timeout: 5s
`,
      );
      clearGateConfigCache();
      const config = getSessionEndNotifyConfig(repoDir, 'cursor');
      expect(config.enabled).toBe(true);
      expect(config.maxSummaryChars).toBe(800);
    });
  });

  describe('session-response-cache', () => {
    it('应读写并清理缓存', () => {
      writeSessionResponse('sess-1', 'cached reply');
      expect(readSessionResponse('sess-1')).toBe('cached reply');
      clearSessionResponse('sess-1');
      expect(readSessionResponse('sess-1')).toBe('');
    });
  });

  describe('notification formatting', () => {
    it('truncateSummary 应截断超长文本', () => {
      const long = 'a'.repeat(20);
      expect(truncateSummary(long, 10)).toBe(`${'a'.repeat(7)}...`);
    });

    it('formatWechatConversationEndMessage 应包含项目与平台', () => {
      const event: ConversationEndEvent = {
        platform: 'Cursor',
        projectName: 'demo',
        sessionId: 's1',
        summaryText: 'summary text',
      };
      const body = formatWechatConversationEndMessage(event, '2026/6/30 12:00:00', 1500);
      const content = (body.markdown as { content: string }).content;
      expect(content).toContain('demo');
      expect(content).toContain('Cursor');
      expect(content).toContain('summary text');
      expect(content).toContain('✅ **对话结束通知**');
    });

    it('conversationEndTitle 应按 status 切换标题', () => {
      expect(conversationEndTitle('completed')).toContain('✅');
      expect(conversationEndTitle('error')).toContain('⚠️');
      expect(conversationEndTitle('aborted')).toContain('⚠️');
    });

    it('formatWechatConversationEndMessage 未提交时应含通用 gitignore 提示', () => {
      const event: ConversationEndEvent = {
        platform: 'Cursor',
        projectName: 'demo',
        sessionId: 's1',
        summaryText: 'summary text',
        uncommittedHint: GENERIC_GITIGNORE_HINT,
      };
      const body = formatWechatConversationEndMessage(event, '2026/6/30 12:00:00', 1500);
      const content = (body.markdown as { content: string }).content;
      expect(content).toContain('**提示**');
      expect(content).toContain(GENERIC_GITIGNORE_HINT);
    });

    it('buildUncommittedWorktreeDenyReason 应含通用 gitignore 提示', () => {
      const reason = buildUncommittedWorktreeDenyReason(repoDir, 'push');
      expect(reason).toContain(GENERIC_GITIGNORE_HINT);
    });
  });

  describe('handleSessionEndNotify', () => {
    it('无 Webhook URL 时应 skip（fail-open）', async () => {
      writeNotifyYaml(repoDir);
      writeSessionResponse('s-end', 'final summary');
      process.env.HOOK_PLATFORM = 'claude';
      const hasWechat = Boolean(getNotificationSettings(repoDir).channels.wechat);
      const result = await handleSessionEndNotify({
        hook_event_name: 'Stop',
        session_id: 's-end',
        last_assistant_message: 'final summary',
        cwd: repoDir,
      });
      if (hasWechat) {
        expect(result.sent).toBe(true);
      } else {
        expect(result.reason).toBe('no_channels');
      }
      clearSessionResponse('s-end');
    });

    it('trigger 不匹配时应 skip', async () => {
      writeNotifyYaml(repoDir, {
        triggerBlock: `    trigger: stop
    maxSummaryChars: 1500
    timeout: 5s
    platforms:
      cursor:
        trigger: stop
      claude:
        trigger: stop
      kiro:
        trigger: stop`,
      });
      process.env.HOOK_PLATFORM = 'cursor';
      const result = await handleSessionEndNotify({
        hook_event_name: 'sessionEnd',
        status: 'completed',
        conversation_id: 'c-stop',
        cwd: repoDir,
        text: 'ignored',
      });
      expect(result.sent).toBe(false);
      expect(result.reason).toBe('trigger_filtered');
    });

    it('trigger both 时 sessionEnd 应尝试发送', async () => {
      writeNotifyYaml(repoDir);
      writeSessionResponse('s-both', 'session end summary');
      process.env.HOOK_PLATFORM = 'cursor';
      const result = await handleSessionEndNotify({
        hook_event_name: 'sessionEnd',
        status: 'completed',
        conversation_id: 'c-both',
        cwd: repoDir,
        text: 'session end summary',
      });
      expect(result.reason).not.toBe('trigger_filtered');
      clearSessionResponse('s-both');
    });

    it('Cursor stop aborted 时应尝试发送（非 trigger_filtered）', async () => {
      writeNotifyYaml(repoDir);
      writeSessionResponse('c-abort', 'aborted summary');
      process.env.HOOK_PLATFORM = 'cursor';
      const result = await handleSessionEndNotify({
        hook_event_name: 'Stop',
        status: 'aborted',
        conversation_id: 'c-abort',
        cwd: repoDir,
        text: 'aborted summary',
      });
      expect(result.reason).not.toBe('trigger_filtered');
      clearSessionResponse('c-abort');
    });


    it('空 summary 且 fallbackOnEmptySummary 时应走 fallback 而非 empty_summary', async () => {
      mkdirSync(join(repoDir, '.claude'), { recursive: true });
      writeFileSync(
        join(repoDir, '.claude/quality-gate.yaml'),
        `settings:
  notifications:
    timeout: 5s
    cooldown: 5m
    channels:
      wechat:
        url: ""
ide:
  session-end-notify:
    enabled: true
    trigger: both
    maxSummaryChars: 1500
    fallbackOnEmptySummary: true
    timeout: 5s
    platforms:
      cursor:
        trigger: both
      claude:
        trigger: both
      kiro:
        trigger: both
`,
      );
      clearGateConfigCache();
      process.env.HOOK_PLATFORM = 'cursor';
      const result = await handleSessionEndNotify({
        hook_event_name: 'sessionEnd',
        status: 'completed',
        conversation_id: 'c-fallback',
        cwd: repoDir,
        text: '',
      });
      expect(result.reason).not.toBe('empty_summary');
      expect(result.reason).not.toBe('trigger_filtered');
    });

    it('buildFallbackSummaryText 应包含项目与会话短码', () => {
      const parsed = parseConversationEndInput({
        hook_event_name: 'sessionEnd',
        conversation_id: 'abcdef12-rest',
        status: 'completed',
        cwd: repoDir,
        workspace_roots: [join(repoDir, 'demo-project')],
      });
      const fallback = buildFallbackSummaryText(parsed);
      expect(fallback).toContain('demo-project');
      expect(fallback).toContain('abcdef12');
      expect(fallback).toContain('无可用摘要');
    });

    it('resolveSummaryText 应优先 inline 再读缓存', () => {
      writeSessionResponse('sess-inline', 'from cache');
      const parsed = parseConversationEndInput({
        hook_event_name: 'Stop',
        session_id: 'sess-inline',
        last_assistant_message: 'inline text',
        cwd: repoDir,
      });
      expect(resolveSummaryText(parsed)).toBe('inline text');
      clearSessionResponse('sess-inline');
    });
  });

  describe('extractLastAssistantFromTranscript', () => {
    it('应解析 jsonl 末条 assistant', () => {
      const transcriptDir = join(homedir(), '.claude', 'cache', 'test-transcripts');
      mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = join(transcriptDir, 'sample.jsonl');
      writeFileSync(
        transcriptPath,
        [
          JSON.stringify({ type: 'user', message: { content: 'hi' } }),
          JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'hello from transcript' }] },
          }),
        ].join('\n'),
      );
      expect(extractLastAssistantFromTranscript(transcriptPath)).toBe('hello from transcript');
      rmSync(transcriptPath, { force: true });
    });

    it('缺失文件应返回空字符串', () => {
      expect(extractLastAssistantFromTranscript('/nonexistent/path.jsonl')).toBe('');
    });
  });

  describe('getNotificationSettings', () => {
    it('应从 yaml 读取 webhook url', () => {
      mkdirSync(join(repoDir, '.claude'), { recursive: true });
      writeFileSync(
        join(repoDir, '.claude/quality-gate.yaml'),
        `settings:
  notifications:
    channels:
      wechat:
        url: "https://example.com/hook"
`,
      );
      clearGateConfigCache();
      const settings = getNotificationSettings(repoDir);
      expect(settings.channels.wechat).toBe('https://example.com/hook');
    });
  });
});
