#!/usr/bin/env bun
/**
 * Session workflow state for worktree / todo / ship orchestration.
 * Stored at ~/.claude/workflow-state/<session_id>.json
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type WorkflowTodoKind = 'explore' | 'impl' | 'ship' | 'other';
export type WorkflowTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface WorkflowTodo {
  id: string;
  content: string;
  kind: WorkflowTodoKind;
  status: WorkflowTodoStatus;
}

export interface ActiveBackgroundTask {
  agentId: string;
  todoId?: string;
  runInBackground: boolean;
  startedAt: string;
}

export type WorkflowPhase =
  | 'planning'
  | 'exploring'
  | 'implementing'
  | 'shipping'
  | 'pushing'
  | 'merging'
  | 'ci_fix_loop'
  | 'done';

export type ShipStatus = 'pending' | 'commit_ok' | 'push_ok' | 'merge_ok' | 'failed';

export interface WorkflowState {
  phase: WorkflowPhase;
  level: 'L1' | 'L2' | 'L3';
  feature_branch?: string;
  session_worktree?: string;
  todos: WorkflowTodo[];
  active_background_tasks: ActiveBackgroundTask[];
  ship_status: ShipStatus;
  ship_attempts: number;
  last_ship_error: string;
  merge_target?: string;
  agent_role?: string;
}

const STATE_DIR = join(homedir(), '.claude', 'workflow-state');

export function getWorkflowStatePath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  return join(STATE_DIR, `${safe}.json`);
}

export function defaultWorkflowState(): WorkflowState {
  return {
    phase: 'planning',
    level: 'L2',
    todos: [],
    active_background_tasks: [],
    ship_status: 'pending',
    ship_attempts: 0,
    last_ship_error: '',
  };
}

export function loadWorkflowState(sessionId: string): WorkflowState {
  if (!sessionId) return defaultWorkflowState();
  const path = getWorkflowStatePath(sessionId);
  if (!existsSync(path)) return defaultWorkflowState();
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

export function saveWorkflowState(sessionId: string, state: WorkflowState): void {
  if (!sessionId) return;
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const finalPath = getWorkflowStatePath(sessionId);
  const tmpPath = `${finalPath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmpPath, finalPath);
}

export function countPendingTodos(state: WorkflowState): number {
  return state.todos.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
}

export function countActiveBackgroundTasks(state: WorkflowState): number {
  return state.active_background_tasks.length;
}

export interface TodoWriteMergeItem {
  id: string;
  content: string;
  status: WorkflowTodoStatus;
}

export function mergeTodoWriteItems(state: WorkflowState, items: TodoWriteMergeItem[]): WorkflowState {
  const byId = new Map(state.todos.map((t) => [t.id, t]));
  for (const item of items) {
    const existing = byId.get(item.id);
    const kind: WorkflowTodoKind = existing?.kind ?? inferTodoKind(item.content);
    byId.set(item.id, {
      id: item.id,
      content: item.content,
      kind,
      status: item.status,
    });
  }
  return { ...state, todos: [...byId.values()] };
}

function inferTodoKind(content: string): WorkflowTodoKind {
  const lower = content.toLowerCase();
  if (/读取|read|explore|调研|分析/.test(lower)) return 'explore';
  if (/commit|push|merge|ship|提交|推送|合并/.test(lower)) return 'ship';
  if (/实现|impl|编写|修改|fix|开发/.test(lower)) return 'impl';
  return 'other';
}

export function parseTodoWriteFromToolResponse(raw: unknown): TodoWriteMergeItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const todos = obj['todos'] ?? obj['merge'] ?? obj['items'];
  if (!Array.isArray(todos)) return [];
  const result: TodoWriteMergeItem[] = [];
  for (const entry of todos) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e['id'] === 'string' ? e['id'] : '';
    const content = typeof e['content'] === 'string' ? e['content'] : '';
    const statusRaw = typeof e['status'] === 'string' ? e['status'] : 'pending';
    const status = normalizeTodoStatus(statusRaw);
    if (id && content) result.push({ id, content, status });
  }
  return result;
}

function normalizeTodoStatus(value: string): WorkflowTodoStatus {
  switch (value) {
    case 'pending':
    case 'in_progress':
    case 'completed':
    case 'cancelled':
      return value;
    default:
      return 'pending';
  }
}

export function isWorkflowActive(state: WorkflowState): boolean {
  return countPendingTodos(state) > 0;
}

export function countPendingImplTodos(state: WorkflowState): number {
  return state.todos.filter(
    (t) => (t.kind === 'impl' || t.kind === 'other') && (t.status === 'pending' || t.status === 'in_progress'),
  ).length;
}

export function isImplPhaseComplete(state: WorkflowState): boolean {
  const implTodos = state.todos.filter((t) => t.kind === 'impl');
  if (implTodos.length === 0) return false;
  return implTodos.every((t) => t.status === 'completed' || t.status === 'cancelled');
}

export function needsShipBeforeStop(state: WorkflowState): boolean {
  if (!isImplPhaseComplete(state)) return false;
  return state.ship_status !== 'merge_ok';
}

export function buildShipStopDenyReason(state: WorkflowState): string {
  const status = state.ship_status;
  const attempts = state.ship_attempts;
  const error = state.last_ship_error ? `\n上次错误: ${state.last_ship_error}` : '';

  if (status === 'pending' || status === 'failed') {
    return [
      '🔒 [auto-commit] impl 已完成，须 dispatch 后台 ship-sa 完成 commit/push/merge。',
      '',
      `ship_status=${status}，ship_attempts=${String(attempts)}${error}`,
      '',
      '步骤：',
      '1. Task(background, shell) ship-sa — git add + commit（过 pre-commit）',
      '2. 成功后 merge-sa — merge + push',
      '3. 失败则 ci-fixer-sa 修复后重试',
    ].join('\n');
  }

  if (status === 'commit_ok' || status === 'push_ok') {
    return [
      '🔒 [auto-commit] ship 未完成，须 dispatch merge-sa 直至 ship_status=merge_ok。',
      '',
      `ship_status=${status}，ship_attempts=${String(attempts)}${error}`,
      '',
      '步骤：',
      '1. Task(background) merge-sa — merge feat/* + push',
      '2. 失败则 ci-fixer-sa → gate-retry-stop 循环',
    ].join('\n');
  }

  return [
    '🔒 [auto-commit] workflow 活跃，ship 未完成（ship_status 须为 merge_ok）。',
    '',
    `ship_status=${status}${error}`,
  ].join('\n');
}
