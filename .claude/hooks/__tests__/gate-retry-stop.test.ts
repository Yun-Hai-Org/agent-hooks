import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  isGateRetryStopEnabled,
  isAutoRetryMergeEnabled,
  getMaxGateRetryLoops,
  runGateRetryStop,
  executePendingMerge,
  main,
} from '../gate-retry-stop.js';
import { handleUserPromptSubmit } from '../user-prompt-filter.js';
import { runResolveHookPathCli } from '../resolve-hook-path.js';
import { setPendingGateFailure, clearPendingGateFailure } from '../gate-pending.js';
import { createTempGitRepo, cleanupTempGitRepo, bootstrapQualityGateYaml, PROJECT_ROOT } from './helpers.js';
import { Readable } from 'stream';

describe('gate-retry-stop helpers', () => {
  it('isGateRetryStopEnabled 默认 true', () => {
    delete process.env.GATE_RETRY_STOP;
    expect(isGateRetryStopEnabled()).toBe(true);
    process.env.GATE_RETRY_STOP = '0';
    expect(isGateRetryStopEnabled()).toBe(false);
    delete process.env.GATE_RETRY_STOP;
  });

  it('isAutoRetryMergeEnabled 默认 true', () => {
    delete process.env.GATE_AUTO_RETRY_MERGE;
    expect(isAutoRetryMergeEnabled()).toBe(true);
    process.env.GATE_AUTO_RETRY_MERGE = 'off';
    expect(isAutoRetryMergeEnabled()).toBe(false);
    delete process.env.GATE_AUTO_RETRY_MERGE;
  });

  it('getMaxGateRetryLoops 解析环境变量与非法值', () => {
    process.env.GATE_RETRY_MAX_LOOPS = '3';
    expect(getMaxGateRetryLoops()).toBe(3);
    process.env.GATE_RETRY_MAX_LOOPS = 'bad';
    expect(getMaxGateRetryLoops()).toBe(8);
    delete process.env.GATE_RETRY_MAX_LOOPS;
  });
});

describe('runGateRetryStop', () => {
  afterEach(() => {
    clearPendingGateFailure('test-session', PROJECT_ROOT);
    delete process.env.GATE_RETRY_STOP;
  });

  it('无 pending 时 skip', async () => {
    const r = await runGateRetryStop('no-pending-session', { cwd: PROJECT_ROOT });
    expect(r.action).toBe('skip');
    expect(r.reason).toBe('no pending gate failure');
  });

  it('GATE_RETRY_STOP=0 时 skip', async () => {
    process.env.GATE_RETRY_STOP = '0';
    setPendingGateFailure('test-session', { type: 'push', command: 'git push', cwd: PROJECT_ROOT });
    const r = await runGateRetryStop('test-session', { cwd: PROJECT_ROOT });
    expect(r.action).toBe('skip');
    expect(r.reason).toBe('GATE_RETRY_STOP disabled');
  });
});

describe('executePendingMerge', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/merge-exec');
    bootstrapQualityGateYaml(repoDir);
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('应执行 pending 命令', () => {
    const result = executePendingMerge({ type: 'merge', command: 'git rev-parse --short HEAD', cwd: repoDir });
    expect(result.success).toBe(true);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});

describe('gate-retry-stop main', () => {
  const origStdin = process.stdin;
  const origLog = console.log;

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    console.log = origLog;
    delete process.env.GATE_RETRY_STOP;
    delete process.env.GATE_RETRY_MAX_LOOPS;
    clearPendingGateFailure('main-test', PROJECT_ROOT);
  });

  it('GATE_RETRY_STOP=0 时输出 {}', async () => {
    process.env.GATE_RETRY_STOP = '0';
    const logs: string[] = [];
    console.log = (msg) => logs.push(String(msg));
    Object.defineProperty(process, 'stdin', {
      value: Readable.from(['{"session_id":"main-test"}']),
      configurable: true,
    });
    await main();
    expect(logs).toContain('{}');
  });

  it('无效 JSON 时 fail-open 输出 {}', async () => {
    const logs: string[] = [];
    console.log = (msg) => logs.push(String(msg));
    Object.defineProperty(process, 'stdin', { value: Readable.from(['not-json']), configurable: true });
    await main();
    expect(logs).toContain('{}');
  });
});

describe('handleUserPromptSubmit', () => {
  const origLog = console.log;

  afterEach(() => {
    console.log = origLog;
  });

  it('非 UserPromptSubmit 事件放行', async () => {
    const logs: string[] = [];
    console.log = (msg) => logs.push(String(msg));
    await handleUserPromptSubmit({ tool_name: 'Bash', cwd: PROJECT_ROOT });
    expect(logs).toEqual(['{}']);
  });

  it('敏感 prompt 应 deny', async () => {
    const logs: string[] = [];
    console.log = (msg) => logs.push(String(msg));
    await handleUserPromptSubmit({
      tool_name: 'UserPromptSubmit',
      tool_input: { user_prompt: 'key AKIAIOSFODNN7EXAMPLE' },
      session_id: 's1',
      cwd: PROJECT_ROOT,
    });
    const parsed = JSON.parse(logs[0] ?? '{}');
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('普通 prompt 放行', async () => {
    const logs: string[] = [];
    console.log = (msg) => logs.push(String(msg));
    await handleUserPromptSubmit({
      tool_name: 'UserPromptSubmit',
      tool_input: { user_prompt: 'hello world' },
      session_id: 's2',
      cwd: PROJECT_ROOT,
    });
    expect(logs).toEqual(['{}']);
  });
});

describe('runResolveHookPathCli', () => {
  const origError = console.error;
  const origLog = console.log;

  afterEach(() => {
    console.error = origError;
    console.log = origLog;
  });

  it('缺少参数时返回 0', () => {
    const errors: string[] = [];
    const logs: string[] = [];
    console.error = (msg) => errors.push(String(msg));
    console.log = (msg) => logs.push(String(msg));
    expect(runResolveHookPathCli(['bun', 'resolve-hook-path.ts'])).toBe(0);
    expect(errors.some((e) => e.includes('用法'))).toBe(true);
    expect(logs).toContain('{}');
  });

  it('未知 hook 时返回 0', () => {
    const logs: string[] = [];
    console.log = (msg) => logs.push(String(msg));
    expect(runResolveHookPathCli(['bun', 'resolve-hook-path.ts', 'nonexistent-hook-xyz.ts'])).toBe(0);
    expect(logs).toContain('{}');
  });
});
