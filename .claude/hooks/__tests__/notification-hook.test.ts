import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { spawn } from 'child_process';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { getHookProcessEnv } from '../security-orchestrator.js';
import { resolveBunExecutable } from '../checks/tools.js';
import { clearGateConfigCache } from '../gate-config.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';
import {
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
  handleNotification,
  DEFAULT_COOLDOWN_MS,
} from '../notification-hook.js';

// notification-hook 测试 - 频控、消息格式化、Webhook 发送、fail-open
describe('notification-hook', () => {
  const HOOK_PATH = join(import.meta.dir, '..', 'notification-hook.ts');

  // 辅助函数：运行 hook 并获取输出
  function runHook(input = '{}', envOverrides = {}, cwd = process.cwd()) {
    return new Promise((resolve, reject) => {
      const child = spawn(resolveBunExecutable(), [HOOK_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getHookProcessEnv(envOverrides),
        cwd,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
      child.on('error', reject);

      child.stdin.write(input);
      child.stdin.end();
    });
  }

  beforeEach(() => {
    clearCooldownState();
  });

  // ─── parseNotificationMessage 测试 ────────────────────────────────────────

  describe('parseNotificationMessage', () => {
    it('应从消息中提取 hook 名称', () => {
      const result = parseNotificationMessage('🚫 [block-dangerous-commands] 拦截了危险命令 rm -rf /');
      expect(result.hook).toBe('block-dangerous-commands');
    });

    it('应识别 HIGH 级别关键词（拦截/阻止）', () => {
      const result = parseNotificationMessage('[protect-secrets] 拦截了敏感文件访问');
      expect(result.severity).toBe('high');
    });

    it('应识别 CRITICAL 级别关键词', () => {
      const result = parseNotificationMessage('[merge-gate] CRITICAL: 发现高危漏洞');
      expect(result.severity).toBe('critical');
    });

    it('应识别 MEDIUM 级别关键词（警告）', () => {
      const result = parseNotificationMessage('[post-write-lint] 警告: 代码风格问题');
      expect(result.severity).toBe('medium');
    });

    it('无匹配时应返回 info 级别', () => {
      const result = parseNotificationMessage('工具健康检查完成');
      expect(result.severity).toBe('info');
      expect(result.hook).toBe('unknown');
    });

    it('空消息应返回默认值', () => {
      const result = parseNotificationMessage('');
      expect(result.hook).toBe('unknown');
      expect(result.severity).toBe('info');
    });

    it('null 消息应返回默认值', () => {
      const result = parseNotificationMessage(null);
      expect(result.hook).toBe('unknown');
      expect(result.severity).toBe('info');
    });
  });

  // ─── mapSeverityEmoji 测试 ─────────────────────────────────────────────────

  describe('mapSeverityEmoji', () => {
    it('critical 应返回 🔴', () => {
      expect(mapSeverityEmoji('critical')).toBe('🔴');
    });

    it('high 应返回 🟠', () => {
      expect(mapSeverityEmoji('high')).toBe('🟠');
    });

    it('medium 应返回 🟡', () => {
      expect(mapSeverityEmoji('medium')).toBe('🟡');
    });

    it('low 应返回 🔵', () => {
      expect(mapSeverityEmoji('low')).toBe('🔵');
    });

    it('info 应返回 ℹ️', () => {
      expect(mapSeverityEmoji('info')).toBe('ℹ️');
    });

    it('未知级别应返回 ⚠️', () => {
      expect(mapSeverityEmoji('unknown')).toBe('⚠️');
    });

    it('null/undefined 应返回 ⚠️', () => {
      expect(mapSeverityEmoji(null)).toBe('⚠️');
      expect(mapSeverityEmoji(undefined)).toBe('⚠️');
    });
  });

  // ─── 频控测试 ─────────────────────────────────────────────────────────────

  describe('频控 (isCoolingDown / recordSent)', () => {
    it('未记录过的事件应不处于冷却期', () => {
      expect(isCoolingDown('test-hook:high')).toBe(false);
    });

    it('刚发送过的事件应处于冷却期', () => {
      recordSent('test-hook:high');
      expect(isCoolingDown('test-hook:high')).toBe(true);
    });

    it('不同事件标识应独立冷却', () => {
      recordSent('hook-a:high');
      expect(isCoolingDown('hook-a:high')).toBe(true);
      expect(isCoolingDown('hook-b:high')).toBe(false);
    });

    it('自定义短冷却期应正确过期', () => {
      recordSent('test:event');
      // 用极短的冷却期（0ms）应该立即过期
      expect(isCoolingDown('test:event', 0)).toBe(false);
    });

    it('clearCooldownState 应清除所有状态', () => {
      recordSent('a');
      recordSent('b');
      clearCooldownState();
      expect(isCoolingDown('a')).toBe(false);
      expect(isCoolingDown('b')).toBe(false);
    });
  });

  // ─── makeEventKey 测试 ─────────────────────────────────────────────────────

  describe('makeEventKey', () => {
    it('应拼接 hook 和 severity', () => {
      expect(makeEventKey({ hook: 'commit-gate', severity: 'high' })).toBe('commit-gate:high');
    });

    it('相同参数应产生相同 key', () => {
      const a = makeEventKey({ hook: 'x', severity: 'y' });
      const b = makeEventKey({ hook: 'x', severity: 'y' });
      expect(a).toBe(b);
    });
  });

  // ─── formatWechatMessage 测试 ─────────────────────────────────────────────

  describe('formatWechatMessage', () => {
    it('应输出企业微信 markdown 格式', () => {
      const msg = formatWechatMessage(
        { hook: 'commit-gate', severity: 'high', reason: '拦截了危险提交' },
        '2026-06-08 10:00:00',
      );
      expect(msg.msgtype).toBe('markdown');
      expect(msg.markdown.content).toContain('commit-gate');
      expect(msg.markdown.content).toContain('HIGH');
      expect(msg.markdown.content).toContain('拦截了危险提交');
      expect(msg.markdown.content).toContain('🟠');
    });

    it('应包含时间戳', () => {
      const msg = formatWechatMessage({ hook: 'x', severity: 'info', reason: 'test' }, '2026-06-08 12:00:00');
      expect(msg.markdown.content).toContain('2026-06-08 12:00:00');
    });
  });

  // ─── formatFeishuMessage 测试 ──────────────────────────────────────────────

  describe('formatFeishuMessage', () => {
    it('应输出飞书消息卡片格式', () => {
      const msg = formatFeishuMessage(
        { hook: 'protect-secrets', severity: 'critical', reason: '检测到 API 密钥泄露' },
        '2026-06-08 10:00:00',
      );
      expect(msg.msg_type).toBe('interactive');
      expect(msg.card.header.template).toBe('red');
      expect(msg.card.elements[0].text.content).toContain('protect-secrets');
      expect(msg.card.elements[0].text.content).toContain('CRITICAL');
    });

    it('不同级别应使用不同卡片颜色', () => {
      const high = formatFeishuMessage({ hook: 'x', severity: 'high', reason: '' }, '');
      const low = formatFeishuMessage({ hook: 'x', severity: 'low', reason: '' }, '');
      expect(high.card.header.template).toBe('orange');
      expect(low.card.header.template).toBe('blue');
    });
  });

  // ─── formatSlackMessage 测试 ───────────────────────────────────────────────

  describe('formatSlackMessage', () => {
    it('应输出 Slack Block Kit 格式', () => {
      const msg = formatSlackMessage(
        { hook: 'merge-gate', severity: 'medium', reason: '发现代码质量问题' },
        '2026-06-08 10:00:00',
      );
      expect(msg.attachments).toBeDefined();
      expect(msg.attachments[0].color).toBe('#FFCC00');
      expect(msg.attachments[0].blocks[0].type).toBe('header');
    });

    it('应包含钩子名和级别字段', () => {
      const msg = formatSlackMessage({ hook: 'branch-gate', severity: 'low', reason: '提示信息' }, '');
      const fields = msg.attachments[0].blocks[1].fields;
      expect(fields[0].text).toContain('branch-gate');
      expect(fields[1].text).toContain('LOW');
    });
  });

  // ─── getConfiguredChannels 测试 ────────────────────────────────────────────

  describe('getConfiguredChannels', () => {
    let repoDir: string;

    beforeEach(() => {
      repoDir = createTempGitRepo('feat/notify-channels');
      clearGateConfigCache();
    });

    afterEach(() => {
      cleanupTempGitRepo(repoDir);
      clearGateConfigCache();
    });

    it('未配置 webhook url 时应返回空数组', () => {
      mkdirSync(join(repoDir, '.claude'), { recursive: true });
      writeFileSync(
        join(repoDir, '.claude/quality-gate.yaml'),
        `settings:
  notifications:
    channels:
      wechat:
        url: ""
`,
      );
      clearGateConfigCache();
      const channels = getConfiguredChannels(repoDir);
      expect(channels.length).toBe(0);
    });

    it('应从 quality-gate.yaml 读取企业微信渠道', () => {
      mkdirSync(join(repoDir, '.claude'), { recursive: true });
      writeFileSync(
        join(repoDir, '.claude/quality-gate.yaml'),
        `settings:
  notifications:
    channels:
      wechat:
        url: "https://example.com/wechat"
`,
      );
      clearGateConfigCache();
      const channels = getConfiguredChannels(repoDir);
      expect(channels.length).toBe(1);
      expect(channels[0]?.name).toBe('企业微信');
    });
  });

  // ─── handleNotification 测试 ──────────────────────────────────────────────

  describe('handleNotification', () => {
    let repoDir: string;
    const prevCwd = process.cwd();

    beforeEach(() => {
      repoDir = createTempGitRepo('feat/notify-handle');
      mkdirSync(join(repoDir, '.claude'), { recursive: true });
      writeFileSync(
        join(repoDir, '.claude/quality-gate.yaml'),
        `settings:
  notifications:
    channels:
      wechat:
        url: ""
ide:
  notification:
    enabled: true
`,
      );
      clearGateConfigCache();
      process.chdir(repoDir);
    });

    afterEach(() => {
      process.chdir(prevCwd);
      cleanupTempGitRepo(repoDir);
      clearGateConfigCache();
    });

    it('无渠道配置时应返回 no_channels', async () => {
      const result = await handleNotification({
        tool_input: { message: '[test] deny event' },
        session_id: 'test',
      });
      expect(result.sent).toBe(false);
      expect(result.reason).toBe('no_channels');
    });

    it('冷却期内应返回 cooldown', async () => {
      // 先标记一个事件为已发送
      const event = parseNotificationMessage('[test-hook] deny event');
      recordSent(makeEventKey(event));

      const result = await handleNotification({
        tool_input: { message: '[test-hook] deny event' },
        session_id: 'test',
      });
      expect(result.sent).toBe(false);
      expect(result.reason).toBe('cooldown');
    });

    it('空 tool_input 应不崩溃', async () => {
      const result = await handleNotification({});
      expect(result.sent).toBe(false);
    });

    it('null data 应不崩溃', async () => {
      const result = await handleNotification(null);
      expect(result.sent).toBe(false);
    });
  });

  // ─── sendWebhook 测试 ─────────────────────────────────────────────────────

  describe('sendWebhook', () => {
    it('无效 URL 应返回失败', async () => {
      const result = await sendWebhook('http://localhost:1', { test: true }, 2000);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('超时应返回失败', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      try {
        const result = await sendWebhook('http://example.com/test', { test: true }, 50);
        expect(result.success).toBe(false);
        expect(result.error).toContain('超时');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ─── 完整 Hook 集成测试 ──────────────────────────────────────────────────

  describe('完整 Hook 运行', () => {
    it('应正常退出（exit code 0）', async () => {
      const { code } = await runHook('{}');
      expect(code).toBe(0);
    });

    it('stdout 应输出 {}（始终放行）', async () => {
      const { stdout } = await runHook(
        JSON.stringify({
          tool_name: 'Notification',
          tool_input: { message: '[test-hook] deny event' },
          session_id: 'test-001',
        }),
      );
      expect(stdout.trim()).toBe('{}');
    });

    it('空 stdin 应正常处理', async () => {
      const { code } = await runHook('');
      expect(code).toBe(0);
    });

    it('无效 JSON stdin 应正常降级', async () => {
      const { code } = await runHook('not json at all');
      expect(code).toBe(0);
    });

    it('有 Webhook URL 配置时应尝试发送', async () => {
      const hookRepo = createTempGitRepo('feat/notify-hook-run');
      mkdirSync(join(hookRepo, '.claude'), { recursive: true });
      writeFileSync(
        join(hookRepo, '.claude/quality-gate.yaml'),
        `settings:
  notifications:
    timeout: 2s
    channels:
      wechat:
        url: "http://localhost:1/test"
ide:
  notification:
    enabled: true
`,
      );
      clearGateConfigCache();

      const { code, stdout } = await runHook(
        JSON.stringify({
          tool_name: 'Notification',
          tool_input: {
            message: '🚫 [block-dangerous-commands] 拦截了危险命令',
            notification_type: 'security_event',
          },
          session_id: 'test-002',
        }),
        {},
        hookRepo,
      );
      cleanupTempGitRepo(hookRepo);
      clearGateConfigCache();
      expect(code).toBe(0);
      expect(stdout.trim()).toBe('{}');
    });

    it('应在 15 秒内完成', async () => {
      const start = Date.now();
      await runHook('{}');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(15000);
    });
  });

  // ─── DEFAULT_COOLDOWN_MS 测试 ─────────────────────────────────────────────

  describe('DEFAULT_COOLDOWN_MS', () => {
    it('应为 5 分钟（300000ms）', () => {
      expect(DEFAULT_COOLDOWN_MS).toBe(300000);
    });
  });
});
