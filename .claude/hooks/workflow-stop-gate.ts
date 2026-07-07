#!/usr/bin/env bun
/**
 * Workflow Stop Gate - stop hook
 * When pending todos >= 2, require >= 2 active background tasks before allowing stop.
 */

import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, readStdin } from './security-orchestrator.js';
import { formatStopContinueOutput, formatStopSuccessOutput, getPlatform } from './hook-adapter.js';
import { asString } from './types.js';
import { isGateNodeEnabled } from './gate-config.js';
import { countActiveBackgroundTasks, countPendingTodos, loadWorkflowState } from './workflow-state.js';

const HOOK_NAME = 'workflow-stop-gate';

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
      emit(formatStopSuccessOutput(''));
      return;
    }

    const state = loadWorkflowState(sessionId);
    const pending = countPendingTodos(state);
    const active = countActiveBackgroundTasks(state);

    if (pending >= 2 && active < 2) {
      log({ level: 'BLOCKED', reason: 'parallel background tasks required', pending, active, session_id: sessionId });
      const reason =
        '🔒 [workflow-stop-gate] pending todos ≥2 时须同时维持 ≥2 个后台 Task。请 Task(background) 并行 dispatch explore/implementer 子代理。';
      emit(formatStopContinueOutput(reason));
      return;
    }

    emit(formatStopSuccessOutput(''));
  } catch (e: unknown) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    emit(getPlatform() === 'cursor' ? '{}' : formatStopSuccessOutput(''));
  }
}

if (import.meta.main) {
  void main();
}

export { HOOK_NAME, main };
