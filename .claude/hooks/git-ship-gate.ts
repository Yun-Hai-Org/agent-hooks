#!/usr/bin/env bun
/**
 * Git Ship Gate - beforeShellExecution / preToolUse Shell
 * Denies Orchestrator git commit/push/merge/checkout main; allows ship-sa subagents.
 */

import { existsSync, appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { LOG_DIR, readStdin } from './security-orchestrator.js';
import { normalizeInput, formatDenyOutput, formatAllowOutput, isShellHookInput } from './hook-adapter.js';
import { asString } from './types.js';
import { isGateNodeEnabled } from './gate-config.js';
import { isGitCommitCommand, isGitPushCommand, isGitMergeCommand } from './checks/git-policy.js';
import { defaultWorkflowState, loadWorkflowState, loadShipParentPointer, type WorkflowState } from './workflow-state.js';
import { notifyGateBlockedAsync } from './gate-blocked-notify.js';

const HOOK_NAME = 'git-ship-gate';
const STATE_DIR = join(homedir(), '.claude', 'workflow-state');
export const SHIP_ROLE_PATTERN = /ship-sa|integrator-sa|merge-sa|ci-fixer-sa/;

function log(data: Record<string, unknown>) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: HOOK_NAME, ...data }) + '\n');
  } catch {}
}

function deny(reason: string) {
  return formatDenyOutput('deny', reason);
}

function emit(out: string) {
  process.stdout.write(`${out}\n`);
}

function allow() {
  return formatAllowOutput();
}

function isShipWorkflowState(state: WorkflowState): boolean {
  return (
    state.active_background_tasks.length > 0 &&
    Boolean(state.agent_role) &&
    SHIP_ROLE_PATTERN.test(state.agent_role!)
  );
}

function collectSessionIds(raw: Record<string, unknown>, sessionId?: string): string[] {
  const ids = [sessionId, asString(raw['session_id']), asString(raw['conversation_id'])].filter(
    (id): id is string => Boolean(id),
  );
  return [...new Set(ids)];
}

function parseWorkflowStateFile(path: string): WorkflowState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<WorkflowState>;
    return {
      ...defaultWorkflowState(),
      ...parsed,
      todos: parsed.todos ?? [],
      active_background_tasks: parsed.active_background_tasks ?? [],
    };
  } catch {
    return defaultWorkflowState();
  }
}

function shouldScanRecentShipStates(raw: Record<string, unknown>): boolean {
  if (asString(raw['agent_id']) || asString(raw['agentId'])) return false;
  if (asString(raw['tool_name']) || asString(raw['toolName'])) return false;
  return Boolean(asString(raw['command']));
}

export function loadWorkflowStateForShip(
  raw: Record<string, unknown>,
  sessionId?: string,
): WorkflowState {
  const ids = collectSessionIds(raw, sessionId);
  for (const id of ids) {
    const state = loadWorkflowState(id);
    if (isShipWorkflowState(state)) return state;
  }

  const pointer = loadShipParentPointer();
  if (pointer) {
    const usePointer = !asString(raw['agent_id']) && !asString(raw['agentId']);
    const pointerInIds = ids.includes(pointer.sessionId);
    if (usePointer || pointerInIds) {
      const pointerState = loadWorkflowState(pointer.sessionId);
      if (isShipWorkflowState(pointerState)) return pointerState;
    }
  }

  if (!shouldScanRecentShipStates(raw)) return defaultWorkflowState();

  const allowedIds = new Set([...ids, pointer?.sessionId].filter((id): id is string => Boolean(id)));
  if (allowedIds.size === 0) return defaultWorkflowState();

  try {
    if (!existsSync(STATE_DIR)) return defaultWorkflowState();
    const recentFiles = readdirSync(STATE_DIR)
      .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
      .map((name) => {
        const path = join(STATE_DIR, name);
        return { name, path, mtime: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10);

    for (const { name, path } of recentFiles) {
      const fileSessionId = name.replace(/\.json$/, '');
      if (!allowedIds.has(fileSessionId)) continue;
      const state = parseWorkflowStateFile(path);
      if (isShipWorkflowState(state)) return state;
    }
  } catch {}

  return defaultWorkflowState();
}

export function isOrchestrator(raw: Record<string, unknown>, sessionId?: string): boolean {
  if (asString(raw['agent_id'])) return false;

  const state = loadWorkflowStateForShip(raw, sessionId);
  if (isShipWorkflowState(state)) {
    return false;
  }

  return true;
}

export function isGitShipWriteCommand(cmd: string): boolean {
  if (!cmd) return false;
  if (isGitCommitCommand(cmd) || isGitPushCommand(cmd) || isGitMergeCommand(cmd)) return true;
  if (/\bgh\s+pr\s+create\b/.test(cmd)) return true;
  if (/\bgit\s+pull\b.*\b(origin\s+)?(main|master)\b/.test(cmd)) return true;
  return /\bgit\s+checkout\b.*\b(main|master)\b/.test(cmd);
}

export function isShipAgent(raw: Record<string, unknown>, sessionId: string): boolean {
  const shipState = loadWorkflowStateForShip(raw, sessionId);
  const directState = loadWorkflowState(sessionId);
  const state = isShipWorkflowState(shipState) ? shipState : directState;
  const role = asString(raw['agent_role']) || asString(state.agent_role);
  const desc = [
    asString(raw['description']),
    asString(raw['subagent_description']),
    asString(raw['subagent_type']),
    asString(raw['agent_type']),
  ]
    .filter((s) => s.length > 0)
    .join(' ');
  const combined = `${role} ${desc}`.toLowerCase();
  return SHIP_ROLE_PATTERN.test(combined);
}

export function buildOrchestratorGitShipDenyReason(cmd: string): string {
  return [
    '🔒 [git-ship-gate] 禁止 Orchestrator 执行 git 写操作。',
    '',
    `命令: ${cmd.slice(0, 200)}`,
    '',
    '步骤：',
    '1. impl 完成后 Task(background, shell) dispatch ship-sa — commit 直至 pre-commit 绿',
    '2. Phase 结束 Task(background) dispatch merge-sa — merge + push',
    '3. 失败时 dispatch ci-fixer-sa，勿亲自 Shell git',
  ].join('\n');
}

export function buildSubagentGitShipDenyReason(cmd: string): string {
  return [
    '🔒 [git-ship-gate] 仅 ship-sa / integrator-sa / merge-sa / ci-fixer-sa 可执行 git commit/push/merge。',
    '',
    `命令: ${cmd.slice(0, 200)}`,
    '',
    '步骤：',
    '1. 实现子代理只做 Read/Write，不 commit/push/merge',
    '2. 由 Orchestrator dispatch ship-sa 后台子代理完成 ship',
  ].join('\n');
}

async function main() {
  try {
    const raw = await readStdin();
    const data = normalizeInput(raw);
    const { tool_input, session_id, cwd } = data;
    const workingDir = cwd || process.cwd();

    if (!isShellHookInput(data) && !asString(raw['command'])) {
      emit(allow());
      return;
    }

    if (!isGateNodeEnabled('ide.git-ship-gate', workingDir)) {
      emit(allow());
      return;
    }

    const cmd = asString(raw['command'] ?? tool_input.command);
    if (!cmd) {
      emit(allow());
      return;
    }

    if (!isGitShipWriteCommand(cmd)) {
      emit(allow());
      return;
    }

    if (isOrchestrator(raw, session_id)) {
      const reason = buildOrchestratorGitShipDenyReason(cmd);
      log({ level: 'BLOCKED', reason: 'orchestrator git write', cmd: cmd.slice(0, 200), session_id });
      notifyGateBlockedAsync({
        hook: HOOK_NAME,
        reason,
        cwd: workingDir,
        ...(session_id !== undefined ? { session_id } : {}),
      });
      emit(deny(reason));
      return;
    }

    if (isShipAgent(raw, session_id)) {
      emit(allow());
      return;
    }

    const subReason = buildSubagentGitShipDenyReason(cmd);
    log({ level: 'BLOCKED', reason: 'non-ship subagent git write', cmd: cmd.slice(0, 200), session_id });
    notifyGateBlockedAsync({
      hook: HOOK_NAME,
      reason: subReason,
      cwd: workingDir,
      ...(session_id !== undefined ? { session_id } : {}),
    });
    emit(deny(subReason));
  } catch (e: unknown) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    emit(allow());
  }
}

if (import.meta.main) {
  void main();
}

export { HOOK_NAME, main };
