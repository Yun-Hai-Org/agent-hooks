#!/usr/bin/env bun
/**
 * workflow-subagent-sync — Layer 1/3 of agent-scoped signal routing.
 *
 * Wired in .cursor/hooks.json.example under `subagentStart` / `subagentStop`
 * (and, when present, `preToolUse` Task with env WORKFLOW_SUBAGENT_SYNC=start).
 *
 * Phase is selected by env `WORKFLOW_SUBAGENT_SYNC` = 'start' | 'stop'; falls back
 * to the stdin `hook_event_name` (subagentStart|subagentStop) so the file activates
 * under the existing wiring even before env vars are added.
 *
 * start: write an AgentRegistryEntry (status dispatched) + append an
 *        ActiveBackgroundTask to the dispatcher's WorkflowState.
 * stop:  update the registry entry to completed + commitSha + worktree.
 *        ActiveBackgroundTasks are NOT cleared here (reclaim is T5's job).
 *
 * Always emits '{}' on stdout (Cursor) so it never blocks. Fail-open.
 */

import { readStdin, execCommand, log } from './security-orchestrator.js';
import { asString } from './types.js';
import {
  saveEntry,
  updateEntry,
  type AgentRegistryEntry,
  type AgentTaskKind,
} from './agent-registry.js';
import {
  loadWorkflowState,
  saveWorkflowState,
  type ActiveBackgroundTask,
} from './workflow-state.js';

type SyncPhase = 'start' | 'stop';

function resolvePhase(): SyncPhase | null {
  const env = process.env['WORKFLOW_SUBAGENT_SYNC'];
  if (env === 'start' || env === 'stop') return env;
  return null;
}

function phaseFromEvent(hookEvent: string): SyncPhase | null {
  const lower = hookEvent.toLowerCase();
  if (lower === 'subagentstart' || lower === 'pretooluse') return 'start';
  if (lower === 'subagentstop') return 'stop';
  return null;
}

function inferAgentKind(subagentType: string, description: string): AgentTaskKind {
  const text = `${subagentType} ${description}`.toLowerCase();
  if (/explore|读取|read|调研|分析/.test(text)) return 'explore';
  if (/ship|commit|push|merge|提交|推送|合并|ci-/.test(text)) return 'ship';
  if (/impl|实现|编写|修改|fix|开发|general/.test(text)) return 'impl';
  return 'other';
}

function nowIso(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const sessionId = asString(raw['session_id']) || asString(raw['conversation_id']);
  const agentId = asString(raw['agent_id']);
  if (!agentId || !sessionId) {
    console.log('{}');
    return;
  }

  let phase = resolvePhase();
  if (!phase) {
    const hookEvent = asString(raw['hook_event_name']);
    phase = phaseFromEvent(hookEvent);
  }
  if (!phase) {
    console.log('{}');
    return;
  }

  const dispatcherSessionId = sessionId;
  const todoId = asString(raw['todo_id']) || asString(raw['todoId']) || undefined;
  const subagentType = asString(raw['subagent_type']) || asString(raw['subagentType']);
  const description = asString(raw['description']);
  const agentRole = asString(raw['agent_role']) || undefined;
  const cwd = asString(raw['cwd']) || process.cwd();

  if (phase === 'start') {
    const entry: AgentRegistryEntry = {
      agent_id: agentId,
      dispatcherSessionId,
      kind: inferAgentKind(subagentType, description),
      status: 'dispatched',
      startedAt: nowIso(),
    };
    if (todoId) entry.todoId = todoId;
    if (agentRole) entry.agent_role = agentRole;
    saveEntry(entry);

    const state = loadWorkflowState(dispatcherSessionId);
    const exists = state.active_background_tasks.some((t) => t.agentId === agentId);
    if (!exists) {
      const task: ActiveBackgroundTask = {
        agentId,
        runInBackground: true,
        startedAt: nowIso(),
      };
      if (todoId) task.todoId = todoId;
      state.active_background_tasks.push(task);
      saveWorkflowState(dispatcherSessionId, state);
    }
  } else {
    const commitResult = execCommand('git rev-parse HEAD', { cwd, timeout: 5000 });
    const commitSha = commitResult.success ? commitResult.stdout.trim() : undefined;
    updateEntry(agentId, {
      status: 'completed',
      completedAt: nowIso(),
      worktree: cwd,
      ...(commitSha ? { commitSha } : {}),
    });
  }

  console.log('{}');
}

main().catch((e: unknown) => {
  log('workflow-subagent-sync', {
    level: 'ERROR',
    error: e instanceof Error ? e.message : String(e),
  });
  console.log('{}');
});
