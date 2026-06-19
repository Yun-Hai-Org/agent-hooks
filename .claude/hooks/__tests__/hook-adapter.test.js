import { describe, it, expect } from 'bun:test';
import {
  getPlatform,
  normalizeInput,
  formatDenyOutput,
  formatAllowOutput,
  formatStopContinueOutput,
  formatStopSuccessOutput,
  isShellHookInput,
  isShellTool,
  isFileEditTool,
  normalizeFileEditInput,
} from '../hook-adapter.js';

describe('hook-adapter', () => {
  it('默认 platform 为 claude', () => {
    const prev = process.env.HOOK_PLATFORM;
    delete process.env.HOOK_PLATFORM;
    expect(getPlatform()).toBe('claude');
    if (prev) process.env.HOOK_PLATFORM = prev;
  });

  it('cursor 输入应归一化', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'cursor';
    const normalized = normalizeInput({
      toolName: 'Bash',
      toolInput: { command: 'git status' },
      workspace_roots: ['/tmp/proj'],
    });
    expect(normalized.tool_name).toBe('Bash');
    expect(normalized.cwd).toBe('/tmp/proj');
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('cursor beforeShellExecution 应映射 command 字段', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'cursor';
    const normalized = normalizeInput({
      command: 'git commit -m "feat: test"',
      cwd: '/tmp/proj',
      conversation_id: 'conv-1',
    });
    expect(normalized.tool_name).toBe('Shell');
    expect(normalized.tool_input.command).toBe('git commit -m "feat: test"');
    expect(normalized.session_id).toBe('conv-1');
    expect(isShellHookInput(normalized)).toBe(true);
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('isShellTool 识别 Bash/Shell', () => {
    expect(isShellTool('Bash')).toBe(true);
    expect(isShellTool('Shell')).toBe(true);
    expect(isShellTool('Write')).toBe(false);
  });

  it('cursor afterFileEdit 应映射 file_path', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'cursor';
    const normalized = normalizeFileEditInput({
      file_path: '/tmp/proj/hook-adapter.js',
      conversation_id: 'conv-1',
      workspace_roots: ['/tmp/proj'],
    });
    expect(normalized.tool_name).toBe('Write');
    expect(normalized.tool_input.file_path).toBe('/tmp/proj/hook-adapter.js');
    expect(isFileEditTool(normalized.tool_name)).toBe(true);
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('claude deny 输出格式', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'claude';
    const out = JSON.parse(formatDenyOutput('deny', 'blocked'));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('allow 输出为 {}', () => {
    expect(formatAllowOutput()).toBe('{}');
  });

  it('Stop 成功 Cursor 输出 {}', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'cursor';
    expect(formatStopSuccessOutput('done')).toBe('{}');
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('Stop 成功 Claude 输出 additionalContext', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'claude';
    const out = JSON.parse(formatStopSuccessOutput('done', 'Stop'));
    expect(out.hookSpecificOutput.additionalContext).toBe('done');
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });
});
