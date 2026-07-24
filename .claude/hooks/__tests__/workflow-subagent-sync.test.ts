import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { loadEntry } from '../agent-registry.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

const SCRIPT_PATH = join(import.meta.dir, '..', 'workflow-subagent-sync.ts');

function runScript(
  input: string,
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
    child.stdin.write(input);
    child.stdin.end();
  });
}

// workflow-state.ts computes STATE_DIR at module load from os.homedir(); the test
// process imports it before beforeEach swaps HOME, so read the file directly.
function readWorkflowState(tempHome: string, sessionId: string): Record<string, unknown> | null {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  const path = join(tempHome, '.claude', 'workflow-state', `${safe}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function activeTaskCount(state: Record<string, unknown> | null): number {
  if (!state) return 0;
  const tasks = state['active_background_tasks'];
  return Array.isArray(tasks) ? tasks.length : 0;
}

describe('workflow-subagent-sync', () => {
  let tempHome: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), `wss-${Date.now()}-`));
    savedHome = process.env['HOME'];
    process.env['HOME'] = tempHome;
  });

  afterEach(() => {
    process.env['HOME'] = savedHome;
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('start writes a registry entry (dispatched) and adds an ActiveBackgroundTask', async () => {
    const input = JSON.stringify({
      session_id: 'disp-sess-1',
      agent_id: 'agent-x',
      subagent_type: 'explore',
      description: '读取 plan docs',
      todo_id: 'todo-1',
      agent_role: 'explorer',
    });
    const res = await runScript(input, { WORKFLOW_SUBAGENT_SYNC: 'start' });
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('{}');

    const entry = loadEntry('agent-x');
    expect(entry).not.toBeNull();
    expect(entry!.agent_id).toBe('agent-x');
    expect(entry!.dispatcherSessionId).toBe('disp-sess-1');
    expect(entry!.status).toBe('dispatched');
    expect(entry!.kind).toBe('explore');
    expect(entry!.todoId).toBe('todo-1');
    expect(entry!.agent_role).toBe('explorer');
    expect(typeof entry!.startedAt).toBe('string');

    const state = readWorkflowState(tempHome, 'disp-sess-1');
    expect(activeTaskCount(state)).toBeGreaterThan(0);
    const tasks = (state!['active_background_tasks'] as Array<Record<string, unknown>>);
    const task = tasks.find((t) => t['agentId'] === 'agent-x');
    expect(task).toBeDefined();
    expect(task!['runInBackground']).toBe(true);
    expect(task!['todoId']).toBe('todo-1');
    expect(typeof task!['startedAt']).toBe('string');
  });

  it('start is idempotent for the same agentId (no duplicate active task)', async () => {
    const input = JSON.stringify({
      session_id: 'disp-sess-2',
      agent_id: 'agent-y',
      subagent_type: 'generalPurpose',
      description: '实现 feature',
    });
    await runScript(input, { WORKFLOW_SUBAGENT_SYNC: 'start' });
    await runScript(input, { WORKFLOW_SUBAGENT_SYNC: 'start' });
    const state = readWorkflowState(tempHome, 'disp-sess-2');
    const tasks = (state!['active_background_tasks'] as Array<Record<string, unknown>>);
    expect(tasks.filter((t) => t['agentId'] === 'agent-y')).toHaveLength(1);
  });

  it('stop sets registry status=completed with commitSha and worktree', async () => {
    const repo = createTempGitRepo('feat/test-sync');
    try {
      const startInput = JSON.stringify({
        session_id: 'disp-sess-3',
        agent_id: 'agent-z',
        subagent_type: 'shell',
        description: 'git commit and push',
        cwd: repo,
      });
      await runScript(startInput, { WORKFLOW_SUBAGENT_SYNC: 'start' });

      const stopInput = JSON.stringify({
        session_id: 'disp-sess-3',
        agent_id: 'agent-z',
        cwd: repo,
      });
      const res = await runScript(stopInput, { WORKFLOW_SUBAGENT_SYNC: 'stop' });
      expect(res.code).toBe(0);
      expect(res.stdout.trim()).toBe('{}');

      const entry = loadEntry('agent-z');
      expect(entry).not.toBeNull();
      expect(entry!.status).toBe('completed');
      expect(entry!.commitSha).toBeTruthy();
      expect(entry!.commitSha).toMatch(/^[0-9a-f]{7,40}$/);
      expect(entry!.worktree).toBe(repo);
      expect(typeof entry!.completedAt).toBe('string');

      // stop must NOT clear active_background_tasks (reclaim is T5's job)
      const state = readWorkflowState(tempHome, 'disp-sess-3');
      const tasks = (state!['active_background_tasks'] as Array<Record<string, unknown>>);
      expect(tasks.some((t) => t['agentId'] === 'agent-z')).toBe(true);
    } finally {
      cleanupTempGitRepo(repo);
    }
  });

  it('falls back to hook_event_name when env var is absent', async () => {
    const input = JSON.stringify({
      session_id: 'disp-sess-4',
      agent_id: 'agent-ev',
      subagent_type: 'explore',
      description: 'explore codebase',
      hook_event_name: 'subagentStart',
    });
    const res = await runScript(input, {});
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('{}');
    expect(loadEntry('agent-ev')?.status).toBe('dispatched');
  });

  it('fail-open: missing agent_id still emits {} and exits 0', async () => {
    const res = await runScript(JSON.stringify({ session_id: 's' }), { WORKFLOW_SUBAGENT_SYNC: 'start' });
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('{}');
  });

  it('fail-open: unknown phase (no env, no event) still emits {}', async () => {
    const res = await runScript(JSON.stringify({ session_id: 's', agent_id: 'a' }), {});
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('{}');
  });
});
