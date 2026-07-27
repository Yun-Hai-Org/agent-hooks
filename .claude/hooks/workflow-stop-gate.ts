#!/usr/bin/env bun
/**
 * Workflow Stop Gate - stop hook
 * When pending todos >= 2, require >= 2 active background tasks before allowing stop.
 *
 * T5: dispatcher pull/reclaim — before the parallel-check, iterate the
 * dispatcher's active_background_tasks, reclaim completed registry entries
 * (pull model; does not rely on push delivery), and surface a reclaim summary.
 */

import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, readStdin } from './security-orchestrator.js';
import { formatStopContinueOutput, formatStopSuccessOutput, getPlatform } from './hook-adapter.js';
import { asString } from './types.js';
import { isGateNodeEnabled } from './gate-config.js';
import {
  countActiveBackgroundTasks,
  countPendingTodos,
  loadWorkflowState,
  saveWorkflowState,
  type WorkflowState,
} from './workflow-state.js';
import { loadEntry, updateEntry } from './agent-registry.js';

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

interface ReclaimedItem {
  agentId: string;
  commitSha?: string;
  worktree?: string;
}

function reclaimCompletedTasks(sessionId: string, state: WorkflowState): ReclaimedItem[] {
  const reclaimed: ReclaimedItem[] = [];
  const tasks = state.active_background_tasks;
  let changed = false;
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i];
    if (!t || typeof t.agentId !== 'string') continue;
    let entry;
    try {
      entry = loadEntry(t.agentId);
    } catch {
      // fail-open: registry read error must not block stop
      continue;
    }
    if (!entry || entry.status !== 'completed') continue;
    try {
      updateEntry(t.agentId, { status: 'reclaimed' });
    } catch {
      // fail-open: registry write error must not block stop
    }
    reclaimed.push({
      agentId: t.agentId,
      ...(entry.commitSha ? { commitSha: entry.commitSha } : {}),
      ...(entry.worktree ? { worktree: entry.worktree } : {}),
    });
    tasks.splice(i, 1);
    changed = true;
  }
  if (changed) {
    try {
      saveWorkflowState(sessionId, state);
    } catch {
      // fail-open: state persist error must not block stop
    }
  }
  return reclaimed;
}

function buildReclaimSummary(reclaimed: ReclaimedItem[]): string {
  if (reclaimed.length === 0) return '';
  const lines = reclaimed.map((r) => {
    const sha = r.commitSha ?? '(no-sha)';
    const wt = r.worktree ?? '(no-worktree)';
    return `- ${r.agentId} → ${sha} (${wt})`;
  });
  return ['♻️ [workflow-stop-gate] 已回收已完成的后台子代理（pull 模型）:', ...lines].join('\n');
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

    // T5: dispatcher pull/reclaim — runs BEFORE the parallel-check so the
    // check sees an up-to-date active count (completed tasks are removed).
    let reclaimSummary = '';
    try {
      const reclaimed = reclaimCompletedTasks(sessionId, state);
      reclaimSummary = buildReclaimSummary(reclaimed);
    } catch (e: unknown) {
      log({ level: 'ERROR', stage: 'reclaim', error: e instanceof Error ? e.message : String(e) });
      // fail-open: continue to parallel-check
    }

    const pending = countPendingTodos(state);
    const active = countActiveBackgroundTasks(state);
    const parallelBlocked = pending >= 2 && active < 2;

    if (parallelBlocked) {
      log({
        level: 'BLOCKED',
        reason: 'parallel background tasks required',
        pending,
        active,
        session_id: sessionId,
        reclaimed: reclaimSummary.length > 0,
      });
      const parallelReason =
        '🔒 [workflow-stop-gate] pending todos ≥2 时须同时维持 ≥2 个后台 Task。请 Task(background) 并行 dispatch explore/implementer 子代理。';
      const reason = reclaimSummary ? `${parallelReason}\n\n${reclaimSummary}` : parallelReason;
      emit(formatStopContinueOutput(reason));
      return;
    }

    if (reclaimSummary) {
      log({ level: 'ALLOWED', reason: 'reclaim summary surfaced', pending, active, session_id: sessionId });
      const platform = getPlatform();
      if (platform === 'cursor') {
        // Cursor has no success-with-message channel; surface via followup so
        // the dispatcher sees the reclaim summary. Next stop is clean because
        // reclaimed tasks are removed from the active list (no infinite loop).
        emit(formatStopContinueOutput(reclaimSummary));
      } else {
        // claude/kiro: allow stop and carry the summary via additionalContext.
        emit(formatStopSuccessOutput(reclaimSummary));
      }
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
