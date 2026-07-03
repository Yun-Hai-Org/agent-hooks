#!/usr/bin/env bun
/**
 * Workflow Todo Sync - postToolUse TodoWrite
 * Persists TodoWrite items into ~/.claude/workflow-state/<session>.json
 */

import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, readStdin } from './security-orchestrator.js';
import { asString } from './types.js';
import { isGateNodeEnabled } from './gate-config.js';
import {
  loadWorkflowState,
  mergeTodoWriteItems,
  parseTodoWriteFromToolResponse,
  saveWorkflowState,
} from './workflow-state.js';

const HOOK_NAME = 'workflow-todo-sync';

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

async function main() {
  try {
    const raw = await readStdin();
    const sessionId = asString(raw['session_id']) || asString(raw['conversation_id']);
    const cwd =
      asString(raw['cwd']) ||
      (Array.isArray(raw['workspace_roots']) && typeof raw['workspace_roots'][0] === 'string'
        ? raw['workspace_roots'][0]
        : process.cwd());

    if (!isGateNodeEnabled('ide.workflow-gate', cwd)) {
      emit('{}');
      return;
    }

    const toolName = asString(raw['tool_name']) || asString(raw['toolName']);
    if (!/^todowrite$/i.test(toolName)) {
      emit('{}');
      return;
    }

    const toolResponse = raw['tool_response'] ?? raw['toolResponse'];
    const items = parseTodoWriteFromToolResponse(toolResponse);
    if (items.length === 0) {
      emit('{}');
      return;
    }

    const state = loadWorkflowState(sessionId);
    const merged = mergeTodoWriteItems(state, items);
    saveWorkflowState(sessionId, merged);
    log({ level: 'INFO', session_id: sessionId, todo_count: merged.todos.length });
    emit('{}');
  } catch (e: unknown) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    emit('{}');
  }
}

if (import.meta.main) {
  void main();
}

export { HOOK_NAME, main };
