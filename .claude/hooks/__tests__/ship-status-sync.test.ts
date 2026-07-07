import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { defaultWorkflowState, getWorkflowStatePath, loadWorkflowState, saveWorkflowState } from '../workflow-state.js';
import { resolveShipSessionId, syncShipStatusFromNativeHook, updateShipStatus } from '../ship-status-sync.js';
import { PROJECT_ROOT } from './helpers.js';

describe('ship-status-sync', () => {
  const sessionId = `ship-sync-${Date.now()}`;

  afterEach(() => {
    delete process.env['CURSOR_SESSION_ID'];
    delete process.env['SESSION_ID'];
    const statePath = getWorkflowStatePath(sessionId);
    if (existsSync(statePath)) rmSync(statePath, { force: true });
  });

  it('updateShipStatus writes commit_ok', () => {
    saveWorkflowState(sessionId, { ...defaultWorkflowState(), ship_status: 'pending' });
    updateShipStatus(sessionId, 'commit_ok');
    const state = loadWorkflowState(sessionId);
    expect(state.ship_status).toBe('commit_ok');
  });

  it('syncShipStatusFromNativeHook uses CURSOR_SESSION_ID and writes commit_ok', () => {
    process.env['CURSOR_SESSION_ID'] = sessionId;
    saveWorkflowState(sessionId, { ...defaultWorkflowState(), ship_status: 'pending' });

    syncShipStatusFromNativeHook('commit_ok', PROJECT_ROOT);

    const state = loadWorkflowState(sessionId);
    expect(state.ship_status).toBe('commit_ok');
  });

  it('resolveShipSessionId prefers CURSOR_SESSION_ID', () => {
    process.env['CURSOR_SESSION_ID'] = sessionId;
    expect(resolveShipSessionId(PROJECT_ROOT)).toBe(sessionId);
  });

  it('syncShipStatusFromNativeHook records failed status with error', () => {
    process.env['CURSOR_SESSION_ID'] = sessionId;
    saveWorkflowState(sessionId, { ...defaultWorkflowState(), ship_status: 'pending', ship_attempts: 0 });

    syncShipStatusFromNativeHook('failed', PROJECT_ROOT, 'pre-merge-commit quality gate failed');

    const state = loadWorkflowState(sessionId);
    expect(state.ship_status).toBe('failed');
    expect(state.ship_attempts).toBe(1);
    expect(state.last_ship_error).toContain('pre-merge-commit');
  });
});
