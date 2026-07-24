import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import {
  countPendingTodos,
  defaultWorkflowState,
  getWorkflowStatePath,
  loadWorkflowState,
  mergeTodoWriteItems,
  parseTodoWriteFromToolResponse,
  saveWorkflowState,
} from '../workflow-state.js';
import { isOrchestratorInWorkflow } from '../hook-adapter.js';
import { isReadTool, isWriteTool, main as workflowMain } from '../workflow-gate.js';
import { clearGateConfigCache } from '../gate-config.js';
import { expectAllow, expectDeny, PROJECT_ROOT } from './helpers.js';

describe('workflow-state', () => {
  const sessionId = `test-session-${Date.now()}`;
  const statePath = getWorkflowStatePath(sessionId);

  afterEach(() => {
    if (existsSync(statePath)) rmSync(statePath, { force: true });
  });

  it('mergeTodoWriteItems merges todos by id', () => {
    const base = defaultWorkflowState();
    const merged = mergeTodoWriteItems(base, [
      { id: '1', content: '读取 plan', status: 'pending' },
      { id: '2', content: '实现 gate', status: 'pending' },
    ]);
    expect(merged.todos).toHaveLength(2);
    expect(countPendingTodos(merged)).toBe(2);
  });

  it('save and load roundtrip', () => {
    const state = mergeTodoWriteItems(defaultWorkflowState(), [{ id: 'a', content: 'task', status: 'pending' }]);
    saveWorkflowState(sessionId, state);
    const loaded = loadWorkflowState(sessionId);
    expect(loaded.todos).toHaveLength(1);
  });

  it('parseTodoWriteFromToolResponse', () => {
    const items = parseTodoWriteFromToolResponse({
      todos: [{ id: 'x', content: 'explore docs', status: 'pending' }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('x');
  });
});

describe('workflow-gate helpers', () => {
  it('isOrchestratorInWorkflow derives mode from agent_id/state', () => {
    const idle = defaultWorkflowState();
    const active = mergeTodoWriteItems(defaultWorkflowState(), [
      { id: '1', content: 'read plan', status: 'pending' },
    ]);
    expect(isOrchestratorInWorkflow({}, idle)).toBe(false);
    expect(isOrchestratorInWorkflow({}, active)).toBe(true);
    expect(isOrchestratorInWorkflow({ agent_id: 'sa' }, active)).toBe(false);
    expect(isOrchestratorInWorkflow({ agent_mode: 'orchestrator' }, idle)).toBe(true);
    expect(isOrchestratorInWorkflow({ agent_mode: 'ask' }, active)).toBe(false);
  });

  it('tool kind detection', () => {
    expect(isReadTool('Read')).toBe(true);
    expect(isWriteTool('Write')).toBe(true);
    expect(isReadTool('Write')).toBe(false);
  });
});

describe('workflow-gate main()', () => {
  const sessionId = `wf-main-${Date.now()}`;
  let originalStdin: typeof process.stdin;
  let originalStdoutWrite: typeof process.stdout.write;
  let output: string[];

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    output = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk.trimEnd() : Buffer.from(chunk).toString().trimEnd());
      return true;
    }) as typeof process.stdout.write;
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'workflow-gates-enabled.yaml');
    clearGateConfigCache();
  });

  afterEach(() => {
    process.stdin = originalStdin;
    process.stdout.write = originalStdoutWrite;
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
    const statePath = getWorkflowStatePath(sessionId);
    if (existsSync(statePath)) rmSync(statePath, { force: true });
  });

  it('allows ask-mode Read without todos', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'plan.md' },
        session_id: sessionId,
        cwd: PROJECT_ROOT,
        agent_mode: 'ask',
      }),
    ]);
    await workflowMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('denies orchestrator-mode Read without todos (请先 TodoWrite)', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'plan.md' },
        session_id: sessionId,
        cwd: PROJECT_ROOT,
        agent_mode: 'orchestrator',
      }),
    ]);
    await workflowMain();
    expect(expectDeny(output[0]!)).toBe(true);
    expect(output[0]).toContain('TodoWrite');
  });

  it('denies orchestrator Read even with todos', async () => {
    saveWorkflowState(
      sessionId,
      mergeTodoWriteItems(defaultWorkflowState(), [{ id: '1', content: 'read plan', status: 'pending' }]),
    );
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'plan.md' },
        session_id: sessionId,
        cwd: PROJECT_ROOT,
      }),
    ]);
    await workflowMain();
    expect(expectDeny(output[0]!)).toBe(true);
  });

  it('allows subagent Read when todos exist', async () => {
    saveWorkflowState(
      sessionId,
      mergeTodoWriteItems(defaultWorkflowState(), [{ id: '1', content: 'read plan', status: 'pending' }]),
    );
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'plan.md' },
        session_id: sessionId,
        cwd: PROJECT_ROOT,
        agent_id: 'subagent-1',
      }),
    ]);
    await workflowMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('allows subagent Read without todos', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'plan.md' },
        session_id: sessionId,
        cwd: PROJECT_ROOT,
        agent_id: 'subagent-1',
        agent_mode: 'subagent',
      }),
    ]);
    await workflowMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('handles beforeReadFile cursor input', async () => {
    saveWorkflowState(
      sessionId,
      mergeTodoWriteItems(defaultWorkflowState(), [{ id: '1', content: 'read', status: 'pending' }]),
    );
    process.env['HOOK_PLATFORM'] = 'cursor';
    process.stdin = Readable.from([
      JSON.stringify({ file_path: 'README.md', session_id: sessionId, cwd: PROJECT_ROOT, agent_id: 'sa' }),
    ]);
    await workflowMain();
    expect(expectAllow(output[0]!)).toBe(true);
    delete process.env['HOOK_PLATFORM'];
  });
});
