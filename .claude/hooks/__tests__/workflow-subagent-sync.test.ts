import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { clearGateConfigCache } from '../gate-config.js';
import { main, addBackgroundTask, removeBackgroundTask } from '../workflow-subagent-sync.js';
import {
  defaultWorkflowState,
  getWorkflowStatePath,
  loadWorkflowState,
  saveWorkflowState,
} from '../workflow-state.js';
import { PROJECT_ROOT } from './helpers.js';

const GATE_CONFIG = join(import.meta.dir, 'workflow-subagent-enabled.yaml');

describe('workflow-subagent-sync', () => {
  const sessionId = `subagent-sync-${Date.now()}`;

  beforeEach(() => {
    writeFileSync(
      GATE_CONFIG,
      ['ide:', '  workflow-subagent-sync:', '    enabled: true'].join('\n'),
      'utf-8',
    );
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = GATE_CONFIG;
    clearGateConfigCache();
  });

  afterEach(() => {
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
    const statePath = getWorkflowStatePath(sessionId);
    if (existsSync(statePath)) rmSync(statePath, { force: true });
    if (existsSync(GATE_CONFIG)) rmSync(GATE_CONFIG, { force: true });
  });

  it('subagentStart adds active_background_tasks entry', async () => {
    saveWorkflowState(sessionId, defaultWorkflowState());
    let output = '';
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stdout.write;

    process.stdin = Readable.from([
      JSON.stringify({
        hook_event_name: 'subagentStart',
        agent_id: 'agent-abc',
        run_in_background: true,
        session_id: sessionId,
        cwd: PROJECT_ROOT,
      }),
    ]);
    await main();

    const state = loadWorkflowState(sessionId);
    expect(state.active_background_tasks).toHaveLength(1);
    expect(state.active_background_tasks[0]?.agentId).toBe('agent-abc');
    expect(state.active_background_tasks[0]?.runInBackground).toBe(true);
    expect(output.trim()).toBe('{}');
  });

  it('subagentStop removes active_background_tasks entry', async () => {
    let state = addBackgroundTask(defaultWorkflowState(), {
      agentId: 'agent-abc',
      runInBackground: true,
      startedAt: new Date().toISOString(),
    });
    state = addBackgroundTask(state, {
      agentId: 'agent-xyz',
      runInBackground: true,
      startedAt: new Date().toISOString(),
    });
    saveWorkflowState(sessionId, state);

    process.stdin = Readable.from([
      JSON.stringify({
        hookEventName: 'subagentStop',
        agentId: 'agent-abc',
        session_id: sessionId,
        cwd: PROJECT_ROOT,
      }),
    ]);
    await main();

    const loaded = loadWorkflowState(sessionId);
    expect(loaded.active_background_tasks).toHaveLength(1);
    expect(loaded.active_background_tasks[0]?.agentId).toBe('agent-xyz');
  });

  it('addBackgroundTask replaces same agentId', () => {
    const first = addBackgroundTask(defaultWorkflowState(), {
      agentId: 'dup',
      runInBackground: false,
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const second = addBackgroundTask(first, {
      agentId: 'dup',
      runInBackground: true,
      startedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(second.active_background_tasks).toHaveLength(1);
    expect(second.active_background_tasks[0]?.runInBackground).toBe(true);
  });

  it('removeBackgroundTask is idempotent', () => {
    const state = removeBackgroundTask(defaultWorkflowState(), 'missing');
    expect(state.active_background_tasks).toHaveLength(0);
  });
});
