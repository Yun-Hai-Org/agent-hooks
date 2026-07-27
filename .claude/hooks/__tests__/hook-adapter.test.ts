import { describe, it, expect, afterEach } from 'bun:test';
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
  deriveAgentMode,
  isOrchestratorInWorkflow,
} from '../hook-adapter.js';
import { defaultWorkflowState, type WorkflowState } from '../workflow-state.js';

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

  it('cursor allow 输出 permission allow', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'cursor';
    expect(JSON.parse(formatAllowOutput())).toEqual({ permission: 'allow' });
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('cursor deny 输出 permission deny', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'cursor';
    const out = JSON.parse(formatDenyOutput('deny', 'blocked'));
    expect(out.permission).toBe('deny');
    expect(out.agent_message).toBe('blocked');
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('kiro allow 输出 decision allow', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'kiro';
    expect(JSON.parse(formatAllowOutput())).toEqual({ decision: 'allow' });
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('allow 输出为 {}（claude 默认）', () => {
    const prev = process.env.HOOK_PLATFORM;
    delete process.env.HOOK_PLATFORM;
    expect(formatAllowOutput()).toBe('{}');
    if (prev) process.env.HOOK_PLATFORM = prev;
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

  it('kiro 输入应归一化 file_path', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'kiro';
    const normalized = normalizeInput({
      toolName: 'Write',
      toolInput: { file_path: '/tmp/a.ts' },
      sessionId: 'kiro-1',
      cwd: '/tmp',
    });
    expect(normalized.tool_name).toBe('Write');
    expect(normalized.tool_input.file_path).toBe('/tmp/a.ts');
    expect(normalized.session_id).toBe('kiro-1');
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('getPlatform 识别 kiro', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'kiro';
    expect(getPlatform()).toBe('kiro');
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });

  it('Stop continue 非 cursor 输出 block decision', () => {
    const prev = process.env.HOOK_PLATFORM;
    process.env.HOOK_PLATFORM = 'kiro';
    const out = JSON.parse(formatStopContinueOutput('fix it', 'Stop'));
    expect(out.decision).toBe('block');
    expect(out.reason).toBe('fix it');
    if (prev) process.env.HOOK_PLATFORM = prev;
    else delete process.env.HOOK_PLATFORM;
  });
});

describe('deriveAgentMode / isOrchestratorInWorkflow', () => {
  const prevAgentMode = process.env['AGENT_MODE'];

  afterEach(() => {
    if (prevAgentMode === undefined) delete process.env['AGENT_MODE'];
    else process.env['AGENT_MODE'] = prevAgentMode;
  });

  function stateWithPendingTodo(): WorkflowState {
    const state = defaultWorkflowState();
    state.todos = [{ id: 't1', content: 'impl x', kind: 'impl', status: 'pending' }];
    return state;
  }

  it('env AGENT_MODE 覆盖优先', () => {
    process.env['AGENT_MODE'] = 'ask';
    const state = stateWithPendingTodo();
    expect(deriveAgentMode({ agent_id: 'x', agent_mode: 'orchestrator' }, state)).toBe('ask');
  });

  it('raw agent_mode 次优先', () => {
    delete process.env['AGENT_MODE'];
    const state = stateWithPendingTodo();
    expect(deriveAgentMode({ agent_mode: 'orchestrator' }, state)).toBe('orchestrator');
  });

  it('agent_id 在场 → subagent', () => {
    delete process.env['AGENT_MODE'];
    const state = stateWithPendingTodo();
    expect(deriveAgentMode({ agent_id: 'abc' }, state)).toBe('subagent');
  });

  it('无 agent_id + 工作流活跃 → orchestrator', () => {
    delete process.env['AGENT_MODE'];
    const state = stateWithPendingTodo();
    expect(deriveAgentMode({}, state)).toBe('orchestrator');
  });

  it('无 agent_id + 工作流不活跃 → ask', () => {
    delete process.env['AGENT_MODE'];
    expect(deriveAgentMode({}, defaultWorkflowState())).toBe('ask');
  });

  it('非法 env 值回退到 raw agent_mode', () => {
    process.env['AGENT_MODE'] = 'foo';
    const state = stateWithPendingTodo();
    expect(deriveAgentMode({ agent_mode: 'subagent' }, state)).toBe('subagent');
  });

  it('非法 raw agent_mode 回退到 agent_id 判定', () => {
    delete process.env['AGENT_MODE'];
    const state = stateWithPendingTodo();
    expect(deriveAgentMode({ agent_mode: 'foo', agent_id: 'x' }, state)).toBe('subagent');
  });

  it('isOrchestratorInWorkflow 仅在 orchestrator 模式为 true', () => {
    delete process.env['AGENT_MODE'];
    const active = stateWithPendingTodo();
    const inactive = defaultWorkflowState();
    expect(isOrchestratorInWorkflow({}, active)).toBe(true);
    expect(isOrchestratorInWorkflow({}, inactive)).toBe(false);
    expect(isOrchestratorInWorkflow({ agent_id: 'x' }, active)).toBe(false);
  });
});
