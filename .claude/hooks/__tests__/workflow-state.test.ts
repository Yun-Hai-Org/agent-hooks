import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  defaultWorkflowState,
  getWorkflowStatePath,
  loadWorkflowState,
  saveWorkflowState,
} from '../workflow-state.js';

const STATE_DIR = join(homedir(), '.claude', 'workflow-state');

describe('workflow-state atomic write', () => {
  const sessionId = `t2-atomic-${process.pid}-${Date.now()}`;
  const statePath = getWorkflowStatePath(sessionId);
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');

  afterEach(() => {
    if (existsSync(statePath)) rmSync(statePath, { force: true });
    if (existsSync(STATE_DIR)) {
      for (const f of readdirSync(STATE_DIR).filter((fn) => fn.startsWith(`${safe}.json.tmp.`))) {
        rmSync(join(STATE_DIR, f), { force: true });
      }
    }
  });

  it('saveWorkflowState 原子写不残留 tmp 文件', () => {
    const state = { ...defaultWorkflowState(), phase: 'implementing' as const };
    saveWorkflowState(sessionId, state);

    expect(existsSync(statePath)).toBe(true);

    const leftover = readdirSync(STATE_DIR).filter((f) => f.startsWith(`${safe}.json.tmp.`));
    expect(leftover).toEqual([]);

    const loaded = loadWorkflowState(sessionId);
    expect(loaded.phase).toBe('implementing');
  });
});
