import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { main as stopMain } from '../workflow-stop-gate.js';
import { main as syncMain } from '../workflow-todo-sync.js';
import { clearGateConfigCache } from '../gate-config.js';
import {
  defaultWorkflowState,
  getWorkflowStatePath,
  loadWorkflowState,
  mergeTodoWriteItems,
  saveWorkflowState,
} from '../workflow-state.js';
import { PROJECT_ROOT } from './helpers.js';

describe('workflow-stop-gate main()', () => {
  const sessionId = `stop-${Date.now()}`;
  let output: string[];

  beforeEach(() => {
    output = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk.trimEnd() : Buffer.from(chunk).toString().trimEnd());
      return true;
    }) as typeof process.stdout.write;
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'workflow-gates-enabled.yaml');
    clearGateConfigCache();
  });

  afterEach(() => {
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
    const statePath = getWorkflowStatePath(sessionId);
    if (existsSync(statePath)) rmSync(statePath, { force: true });
  });

  it('blocks stop when pending>=2 and active background < 2', async () => {
    const state = mergeTodoWriteItems(defaultWorkflowState(), [
      { id: '1', content: 'a', status: 'pending' },
      { id: '2', content: 'b', status: 'pending' },
    ]);
    saveWorkflowState(sessionId, state);
    process.stdin = Readable.from([JSON.stringify({ session_id: sessionId, cwd: PROJECT_ROOT })]);
    await stopMain();
    expect(output[0]).toContain('workflow-stop-gate');
  });

  it('allows stop with single pending todo', async () => {
    saveWorkflowState(
      sessionId,
      mergeTodoWriteItems(defaultWorkflowState(), [{ id: '1', content: 'only', status: 'pending' }]),
    );
    process.stdin = Readable.from([JSON.stringify({ session_id: sessionId, cwd: PROJECT_ROOT })]);
    await stopMain();
    expect(output[0]).not.toContain('workflow-stop-gate');
  });
});

describe('workflow-todo-sync main()', () => {
  const sessionId = `sync-${Date.now()}`;

  afterEach(() => {
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
    const statePath = getWorkflowStatePath(sessionId);
    if (existsSync(statePath)) rmSync(statePath, { force: true });
  });

  it('persists TodoWrite items to workflow state', async () => {
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'workflow-gates-enabled.yaml');
    clearGateConfigCache();
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'TodoWrite',
        tool_response: { todos: [{ id: 't1', content: 'explore', status: 'pending' }] },
        session_id: sessionId,
        cwd: PROJECT_ROOT,
      }),
    ]);
    await syncMain();
    const loaded = loadWorkflowState(sessionId);
    expect(loaded.todos).toHaveLength(1);
    expect(loaded.todos[0]?.id).toBe('t1');
  });
});
