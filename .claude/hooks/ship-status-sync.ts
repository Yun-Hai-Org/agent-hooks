#!/usr/bin/env bun
/**
 * Ship status sync - writes ship_status to workflow-state on native git hook events.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getCurrentBranch, log } from './security-orchestrator.js';
import {
  loadWorkflowState,
  saveWorkflowState,
  type ShipStatus,
  type WorkflowState,
} from './workflow-state.js';

const HOOK_NAME = 'ship-status-sync';
const STATE_DIR = join(homedir(), '.claude', 'workflow-state');

export function resolveShipSessionId(cwd: string = process.cwd()): string {
  const fromEnv = (process.env['CURSOR_SESSION_ID'] ?? process.env['SESSION_ID'] ?? '').trim();
  if (fromEnv) return fromEnv;
  return findWorkflowSessionByCwd(cwd) ?? '';
}

function findWorkflowSessionByCwd(cwd: string): string | null {
  if (!existsSync(STATE_DIR)) return null;

  const branch = getCurrentBranch(cwd);
  for (const file of readdirSync(STATE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const sessionId = file.slice(0, -'.json'.length);
    try {
      const parsed = JSON.parse(readFileSync(join(STATE_DIR, file), 'utf8')) as Partial<WorkflowState>;
      if (parsed.session_worktree && cwd.includes(parsed.session_worktree)) {
        return sessionId;
      }
      if (branch && parsed.feature_branch === branch) {
        return sessionId;
      }
    } catch {
      // ignore malformed state files
    }
  }
  return null;
}

export function updateShipStatus(sessionId: string, status: ShipStatus, error?: string): void {
  if (!sessionId) {
    log(HOOK_NAME, { level: 'SKIP', reason: 'no session id', ship_status: status });
    return;
  }

  const state = loadWorkflowState(sessionId);
  state.ship_status = status;
  if (status === 'failed') {
    state.ship_attempts += 1;
    if (error) state.last_ship_error = error.slice(0, 500);
  } else if (status === 'merge_ok') {
    state.last_ship_error = '';
  }
  saveWorkflowState(sessionId, state);
  log(HOOK_NAME, {
    level: 'INFO',
    session_id: sessionId,
    ship_status: status,
    ...(error ? { error: error.slice(0, 200) } : {}),
  });
}

export function syncShipStatusFromNativeHook(status: ShipStatus, cwd: string, error?: string): void {
  updateShipStatus(resolveShipSessionId(cwd), status, error);
}
