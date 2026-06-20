import { describe, test, expect } from 'bun:test';
import { scanPrompt } from '../user-prompt-filter.js';
import { spawnSync } from 'child_process';
import { join } from 'path';

const HOOK_PATH = join(import.meta.dir, '..', 'user-prompt-filter.ts');

/**
 * Run the hook script via stdin, return parsed stdout.
 * Uses spawnSync with explicit stdin fd for reliable piping in bun tests.
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
function runHook(input) {
  const result = spawnSync('bun', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return JSON.parse(result.stdout.trim());
}

// ─── scanPrompt 单元测试 ────────────────────────────────────────────────

describe('scanPrompt', () => {
  test('检测 AWS Access Key', () => {
    const result = scanPrompt('请帮我检查这个 key: AKIAIOSFODNN7EXAMPLE');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('aws-access-key');
  });

  test('检测 GitHub Token', () => {
    const result = scanPrompt('我的 token 是 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('github-token');
  });

  test('检测 OpenAI Project API Key', () => {
    const result = scanPrompt('使用 sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234 来调用 API');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('openai-project-key');
  });

  test('检测 Anthropic API Key', () => {
    const result = scanPrompt('ANTHROPIC_API_KEY=sk-ant-api03ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123456');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('anthropic-api-key');
  });

  test('检测 Stripe Secret Key', () => {
    const result = scanPrompt('支付密钥 sk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('stripe-secret');
  });

  test('检测通用 API Key 硬编码', () => {
    const result = scanPrompt('api_key="ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('generic-api-key');
  });

  test('检测硬编码密码', () => {
    const result = scanPrompt('password="MySecretPass123"');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('hardcoded-password');
  });

  test('检测 PEM 私钥', () => {
    const result = scanPrompt('请看这段内容：-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('private-key-pem');
  });

  test('检测数据库连接字符串', () => {
    const result = scanPrompt('连接地址：postgres://admin:secret123@db.example.com:5432/mydb');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('db-connection-string');
  });

  test('检测 Visa 信用卡号', () => {
    const result = scanPrompt('我的卡号是 4111-1111-1111-1111');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('credit-card-visa');
  });

  test('检测中国身份证号', () => {
    const result = scanPrompt('身份证号 110101199001011234');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('cn-id-card');
  });

  test('检测 Slack Token', () => {
    const result = scanPrompt('SLACK_TOKEN=xoxb-abcdefghij-klmnopqrstuv-ABCDefGHIJklmnOPQrst');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('slack-token');
  });

  test('检测 Google API Key', () => {
    const result = scanPrompt('GOOGLE_KEY=AIzaSyA1234567890abcdefghijklmnopqrstuv');
    expect(result.blocked).toBe(true);
    expect(result.pattern?.id).toBe('google-api-key');
  });

  test('普通代码讨论不被拦截', () => {
    const result = scanPrompt('请帮我写一个 React 组件，使用 useState 和 useEffect');
    expect(result.blocked).toBe(false);
    expect(result.pattern).toBeNull();
  });

  test('普通编程问题不被拦截', () => {
    const result = scanPrompt('如何在 Python 中使用 async/await 处理并发请求？');
    expect(result.blocked).toBe(false);
    expect(result.pattern).toBeNull();
  });

  test('空字符串不被拦截', () => {
    const result = scanPrompt('');
    expect(result.blocked).toBe(false);
    expect(result.pattern).toBeNull();
  });

  test('null 输入不被拦截', () => {
    const result = scanPrompt(null);
    expect(result.blocked).toBe(false);
    expect(result.pattern).toBeNull();
  });

  test('undefined 输入不被拦截', () => {
    const result = scanPrompt(undefined);
    expect(result.blocked).toBe(false);
    expect(result.pattern).toBeNull();
  });

  test('非字符串输入不被拦截', () => {
    const result = scanPrompt(12345);
    expect(result.blocked).toBe(false);
    expect(result.pattern).toBeNull();
  });

  test('含多个敏感信息时返回第一个匹配', () => {
    const result = scanPrompt('key=AKIAIOSFODNN7EXAMPLE password="MySecretPass123"');
    expect(result.blocked).toBe(true);
    // AWS key 在 CONTENT_PATTERNS 中排在 password 之前，应先匹配到
    expect(result.pattern?.id).toBe('aws-access-key');
  });
});

// ─── Hook 集成测试 ─────────────────────────────────────────────────────

describe('user-prompt-filter hook 集成', () => {
  test('包含 API 密钥的 prompt 被阻止', () => {
    const output = runHook({
      tool_name: 'UserPromptSubmit',
      tool_input: { user_prompt: '请用 AKIAIOSFODNN7EXAMPLE 这个 key 调用 AWS' },
      session_id: 'test-001',
      cwd: '/tmp',
      permission_mode: 'default',
    });
    expect(output.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain('user-prompt-filter');
    expect(output.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
  });

  test('普通 prompt 放行', () => {
    const output = runHook({
      tool_name: 'UserPromptSubmit',
      tool_input: { user_prompt: '请帮我写一个排序算法' },
      session_id: 'test-002',
      cwd: '/tmp',
      permission_mode: 'default',
    });
    expect(output).toEqual({});
  });

  test('非 UserPromptSubmit 事件放行', () => {
    const output = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo AKIAIOSFODNN7EXAMPLE' },
      session_id: 'test-003',
      cwd: '/tmp',
      permission_mode: 'default',
    });
    expect(output).toEqual({});
  });

  test('空 user_prompt 放行', () => {
    const output = runHook({
      tool_name: 'UserPromptSubmit',
      tool_input: {},
      session_id: 'test-004',
      cwd: '/tmp',
      permission_mode: 'default',
    });
    expect(output).toEqual({});
  });

  test('malformed JSON 不崩溃（fail-open）', () => {
    const result = spawnSync('bun', [HOOK_PATH], {
      input: 'not valid json',
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = JSON.parse(result.stdout.trim());
    expect(output).toEqual({});
  });
});
