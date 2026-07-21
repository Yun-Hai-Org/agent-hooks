#!/usr/bin/env bun
/**
 * Workflow Subagent Sync - subagentStart / subagentStop
 * Tracks active background tasks in ~/.claude/workflow-state/<session>.json
 */

import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, readStdin } from './security-orchestrator.js';
import { asString } from './types.js';
import { isGateNodeEnabled } from './gate-config.js';
import {
  loadWorkflowState,
  saveWorkflowState,
  type ActiveBackgroundTask,
  type WorkflowState,
} from './workflow-state.js';

const HOOK_NAME = 'workflow-subagent-sync';
const SHIP_ROLE_PATTERN = /ship-sa|integrator-sa|merge-sa|ci-fixer-sa/;

function log(data: Record<string, unknown>) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: HOOK_NAME, ...data }) + '\n');
  } catch {}
}

function emit(out: string) {
  process.stdout.write(`${out}\n`);
}

function normalizeHookEvent(raw: Record<string, unknown>): string {
  return asString(raw['hook_event_name']) || asString(raw['hookEventName']);
}

function isSubagentStartEvent(event: string): boolean {
  return event.replace(/_/g, '').toLowerCase() === 'subagentstart';
}

function isSubagentStopEvent(event: string): boolean {
  return event.replace(/_/g, '').toLowerCase() === 'subagentstop';
}

function resolveSyncAction(raw: Record<string, unknown>): 'start' | 'stop' | null {
  const event = normalizeHookEvent(raw);
  if (isSubagentStartEvent(event)) return 'start';
  if (isSubagentStopEvent(event)) return 'stop';

  const envAction = process.env['WORKFLOW_SUBAGENT_SYNC'];
  if (envAction === 'start' || envAction === 'stop') return envAction;

  if (raw['last_assistant_message'] != null || raw['lastAssistantMessage'] != null) {
    return 'stop';
  }

  return null;
}

function resolveAgentId(raw: Record<string, unknown>): string {
  return asString(raw['agent_id']) || asString(raw['agentId']);
}

function resolveShipRole(raw: Record<string, unknown>): string | undefined {
  const fields = [
    asString(raw['description']),
    asString(raw['subagent_description']),
    asString(raw['agent_type']),
  ];
  for (const field of fields) {
    const match = field.match(SHIP_ROLE_PATTERN);
    if (match) return match[0];
  }
  return undefined;
}

function resolveRunInBackground(raw: Record<string, unknown>): boolean {
  if (raw['run_in_background'] === true || raw['runInBackground'] === true) return true;
  if (asString(raw['run_in_background']).toLowerCase() === 'true') return true;
  if (asString(raw['runInBackground']).toLowerCase() === 'true') return true;
  return true;
}

function addBackgroundTask(state: WorkflowState, task: ActiveBackgroundTask): WorkflowState {
  const rest = state.active_background_tasks.filter((t) => t.agentId !== task.agentId);
  return { ...state, active_background_tasks: [...rest, task] };
}

function removeBackgroundTask(state: WorkflowState, agentId: string): WorkflowState {
  return {
    ...state,
    active_background_tasks: state.active_background_tasks.filter((t) => t.agentId !== agentId),
  };
}

async function main() {
  try {
    const raw = await readStdin();
    const sessionId = asString(raw['session_id']) || asString(raw['conversation_id']);
    const cwd =
      asString(raw['cwd']) ||
      (Array.isArray(raw['workspace_roots']) && typeof raw['workspace_roots'][0] === 'string'
        ? raw['workspace_roots'][0]
        : process.cwd());

    if (!isGateNodeEnabled('ide.workflow-subagent-sync', cwd)) {
      emit('{}');
      return;
    }

    const action = resolveSyncAction(raw);
    const agentId = resolveAgentId(raw);
    if (!sessionId || !agentId || !action) {
      emit('{}');
      return;
    }

    let state = loadWorkflowState(sessionId);

    if (action === 'start') {
      state = addBackgroundTask(state, {
        agentId,
        runInBackground: resolveRunInBackground(raw),
        startedAt: new Date().toISOString(),
      });
      const shipRole = resolveShipRole(raw);
      if (shipRole) {
        state = { ...state, agent_role: shipRole };
      }
      log({ level: 'INFO', action: 'add', agent_id: agentId, session_id: sessionId, ...(shipRole ? { agent_role: shipRole } : {}) });
    } else {
      state = removeBackgroundTask(state, agentId);
      if (state.active_background_tasks.length === 0) {
        state = { ...state, agent_role: undefined };
      }
      log({ level: 'INFO', action: 'remove', agent_id: agentId, session_id: sessionId });
    }

    saveWorkflowState(sessionId, state);
    emit('{}');
  } catch (e: unknown) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    emit('{}');
  }
}

if (import.meta.main) {
  void main();
}

export { HOOK_NAME, main, resolveSyncAction, resolveShipRole, addBackgroundTask, removeBackgroundTask };
