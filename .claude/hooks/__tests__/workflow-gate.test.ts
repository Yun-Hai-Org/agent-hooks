import { describe, it, expect, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import {
  countPendingTodos,
  defaultWorkflowState,
  getWorkflowStatePath,
  loadWorkflowState,
  mergeTodoWriteItems,
  parseTodoWriteFromToolResponse,
  saveWorkflowState,
} from '../workflow-state.js';
import { isOrchestrator, isReadTool, isWriteTool } from '../workflow-gate.js';

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
  it('isOrchestrator when no agent_id', () => {
    expect(isOrchestrator({})).toBe(true);
    expect(isOrchestrator({ agent_id: 'abc' })).toBe(false);
  });

  it('tool kind detection', () => {
    expect(isReadTool('Read')).toBe(true);
    expect(isWriteTool('Write')).toBe(true);
    expect(isReadTool('Write')).toBe(false);
  });
});
