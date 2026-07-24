import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { main as stopMain } from '../workflow-stop-gate.js';
import { main as syncMain } from '../workflow-todo-sync.js';
import { clearGateConfigCache } from '../gate-config.js';
import {
  defaultWorkflowState,
  getWorkflowStatePath,
  loadWorkflowState,
  mergeTodoWriteItems,
  saveWorkflowState,
} from '../workflow-state.js';
import { loadEntry, saveEntry, type AgentRegistryEntry } from '../agent-registry.js';
import { PROJECT_ROOT } from './helpers.js';

describe('workflow-stop-gate main()', () => {
  const sessionId = `stop-${Date.now()}`;
  let output: string[];

  beforeEach(() => {
    output = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk.trimEnd() : Buffer.from(chunk).toString().trimEnd());
      return true;
    }) as typeof process.stdout.write;
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'workflow-gates-enabled.yaml');
    clearGateConfigCache();
  });

  afterEach(() => {
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
    const statePath = getWorkflowStatePath(sessionId);
    if (existsSync(statePath)) rmSync(statePath, { force: true });
  });

  it('blocks stop when pending>=2 and active background < 2', async () => {
    const state = mergeTodoWriteItems(defaultWorkflowState(), [
      { id: '1', content: 'a', status: 'pending' },
      { id: '2', content: 'b', status: 'pending' },
    ]);
    saveWorkflowState(sessionId, state);
    process.stdin = Readable.from([JSON.stringify({ session_id: sessionId, cwd: PROJECT_ROOT })]);
    await stopMain();
    expect(output[0]).toContain('workflow-stop-gate');
  });

  it('allows stop with single pending todo', async () => {
    saveWorkflowState(
      sessionId,
      mergeTodoWriteItems(defaultWorkflowState(), [{ id: '1', content: 'only', status: 'pending' }]),
    );
    process.stdin = Readable.from([JSON.stringify({ session_id: sessionId, cwd: PROJECT_ROOT })]);
    await stopMain();
    expect(output[0]).not.toContain('workflow-stop-gate');
  });
});

describe('workflow-todo-sync main()', () => {
  const sessionId = `sync-${Date.now()}`;

  afterEach(() => {
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
    const statePath = getWorkflowStatePath(sessionId);
    if (existsSync(statePath)) rmSync(statePath, { force: true });
  });

  it('persists TodoWrite items to workflow state', async () => {
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'workflow-gates-enabled.yaml');
    clearGateConfigCache();
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'TodoWrite',
        tool_response: { todos: [{ id: 't1', content: 'explore', status: 'pending' }] },
        session_id: sessionId,
        cwd: PROJECT_ROOT,
      }),
    ]);
    await syncMain();
    const loaded = loadWorkflowState(sessionId);
    expect(loaded.todos).toHaveLength(1);
    expect(loaded.todos[0]?.id).toBe('t1');
  });
});

// ---- T5: dispatcher pull/reclaim (AC3, AC7, fail-open) ----
// workflow-state.ts computes STATE_DIR at module load from os.homedir(); the
// test process imports it before beforeEach swaps HOME, so saveWorkflowState
// in the test process writes to the REAL home. The child process (HOME=tempHome)
// reads from tempHome. Therefore write state files DIRECTLY to tempHome here.

const STOP_GATE_SCRIPT = join(import.meta.dir, '..', 'workflow-stop-gate.ts');

function stateFilePath(tempHome: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  return join(tempHome, '.claude', 'workflow-state', `${safe}.json`);
}

function writeStateFile(tempHome: string, sessionId: string, state: Record<string, unknown>): void {
  const path = stateFilePath(tempHome, sessionId);
  mkdirSync(join(tempHome, '.claude', 'workflow-state'), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

function readStateFile(tempHome: string, sessionId: string): Record<string, unknown> | null {
  const path = stateFilePath(tempHome, sessionId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function runStopGate(
  input: string,
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STOP_GATE_SCRIPT], {
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

function makeCompletedEntry(
  agentId: string,
  dispatcher: string,
  commitSha: string,
  worktree: string,
): AgentRegistryEntry {
  return {
    agent_id: agentId,
    dispatcherSessionId: dispatcher,
    kind: 'impl',
    status: 'completed',
    startedAt: new Date(Date.now() - 60000).toISOString(),
    completedAt: new Date().toISOString(),
    commitSha,
    worktree,
  };
}

describe('workflow-stop-gate T5 reclaim (child-process, temp HOME)', () => {
  let tempHome: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), `wsg-t5-${Date.now()}-`));
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

  it('AC3: completed active task is reclaimed, removed from active list, summary mentions commitSha', async () => {
    const sessionId = `t5-ac3-${Date.now()}`;
    const agentId = 'agent-ac3';
    const commitSha = 'deadbeefdeadbeef';
    const worktree = '/tmp/wt-ac3';

    saveEntry(makeCompletedEntry(agentId, sessionId, commitSha, worktree));

    const state = defaultWorkflowState();
    state.active_background_tasks = [
      { agentId, runInBackground: true, startedAt: new Date().toISOString() },
    ];
    writeStateFile(tempHome, sessionId, state as unknown as Record<string, unknown>);

    const res = await runStopGate(
      JSON.stringify({ session_id: sessionId, cwd: PROJECT_ROOT }),
      {
        HOOK_PLATFORM: 'claude',
        QUALITY_GATE_GLOBAL_CONFIG_PATH: join(import.meta.dir, 'workflow-gates-enabled.yaml'),
      },
    );
    expect(res.code).toBe(0);

    const after = loadEntry(agentId);
    expect(after?.status).toBe('reclaimed');

    const st = readStateFile(tempHome, sessionId);
    const tasks = (st?.['active_background_tasks'] as Array<Record<string, unknown>>) ?? [];
    expect(tasks.some((t) => t['agentId'] === agentId)).toBe(false);
    expect(tasks).toHaveLength(0);

    expect(res.stdout).toContain(commitSha);
    expect(res.stdout).toContain('workflow-stop-gate');
  });

  it('AC7: pending>=2 + 2 active (running) allows; pending>=2 + 0 active blocks', async () => {
    const sidAllow = `t5-ac7-allow-${Date.now()}`;
    const stAllow = mergeTodoWriteItems(defaultWorkflowState(), [
      { id: '1', content: 'a', status: 'pending' },
      { id: '2', content: 'b', status: 'pending' },
    ]);
    stAllow.active_background_tasks = [
      { agentId: 'run-a', runInBackground: true, startedAt: new Date().toISOString() },
      { agentId: 'run-b', runInBackground: true, startedAt: new Date().toISOString() },
    ];
    saveEntry({ agent_id: 'run-a', dispatcherSessionId: sidAllow, kind: 'impl', status: 'running', startedAt: new Date().toISOString() });
    saveEntry({ agent_id: 'run-b', dispatcherSessionId: sidAllow, kind: 'impl', status: 'running', startedAt: new Date().toISOString() });
    writeStateFile(tempHome, sidAllow, stAllow as unknown as Record<string, unknown>);

    const allowRes = await runStopGate(
      JSON.stringify({ session_id: sidAllow, cwd: PROJECT_ROOT }),
      {
        HOOK_PLATFORM: 'claude',
        QUALITY_GATE_GLOBAL_CONFIG_PATH: join(import.meta.dir, 'workflow-gates-enabled.yaml'),
      },
    );
    expect(allowRes.code).toBe(0);
    expect(allowRes.stdout).not.toContain('"decision":"block"');
    expect(allowRes.stdout).not.toContain('pending todos');
    const stAllowAfter = readStateFile(tempHome, sidAllow);
    const allowTasks = (stAllowAfter?.['active_background_tasks'] as Array<Record<string, unknown>>) ?? [];
    expect(allowTasks).toHaveLength(2);

    const sidBlock = `t5-ac7-block-${Date.now()}`;
    const stBlock = mergeTodoWriteItems(defaultWorkflowState(), [
      { id: '1', content: 'a', status: 'pending' },
      { id: '2', content: 'b', status: 'pending' },
    ]);
    writeStateFile(tempHome, sidBlock, stBlock as unknown as Record<string, unknown>);

    const blockRes = await runStopGate(
      JSON.stringify({ session_id: sidBlock, cwd: PROJECT_ROOT }),
      {
        HOOK_PLATFORM: 'claude',
        QUALITY_GATE_GLOBAL_CONFIG_PATH: join(import.meta.dir, 'workflow-gates-enabled.yaml'),
      },
    );
    expect(blockRes.code).toBe(0);
    expect(blockRes.stdout).toContain('"decision":"block"');
    expect(blockRes.stdout).toContain('workflow-stop-gate');
  });

  it('fail-open: corrupt registry entry does not block stop (reclaim no-op, parallel-check allows)', async () => {
    const sessionId = `t5-fo-corrupt-${Date.now()}`;
    const agentId = 'agent-corrupt';

    // Plant a corrupt registry file (invalid JSON) so loadEntry returns null.
    const regDir = join(tempHome, '.claude', 'agent-registry');
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(regDir, `${agentId}.json`), '{not valid json', 'utf8');

    const state = defaultWorkflowState();
    state.active_background_tasks = [
      { agentId, runInBackground: true, startedAt: new Date().toISOString() },
    ];
    writeStateFile(tempHome, sessionId, state as unknown as Record<string, unknown>);

    const res = await runStopGate(
      JSON.stringify({ session_id: sessionId, cwd: PROJECT_ROOT }),
      {
        HOOK_PLATFORM: 'claude',
        QUALITY_GATE_GLOBAL_CONFIG_PATH: join(import.meta.dir, 'workflow-gates-enabled.yaml'),
      },
    );
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain('"decision":"block"');
    // active task untouched (nothing reclaimed)
    const st = readStateFile(tempHome, sessionId);
    const tasks = (st?.['active_background_tasks'] as Array<Record<string, unknown>>) ?? [];
    expect(tasks.some((t) => t['agentId'] === agentId)).toBe(true);
  });

  it('fail-open: state persist error mid-reclaim does not block stop', async () => {
    const sessionId = `t5-fo-persist-${Date.now()}`;
    const agentId = 'agent-persist';

    saveEntry(makeCompletedEntry(agentId, sessionId, 'cafef00d', '/tmp/wt-persist'));

    const state = defaultWorkflowState();
    state.active_background_tasks = [
      { agentId, runInBackground: true, startedAt: new Date().toISOString() },
    ];
    writeStateFile(tempHome, sessionId, state as unknown as Record<string, unknown>);

    // Make workflow-state dir read-only (0500) so saveWorkflowState's
    // writeFileSync(tmp) throws EACCES mid-reclaim. Load still succeeds
    // (read on file + execute on dir). Registry dir stays writable.
    chmodSync(join(tempHome, '.claude', 'workflow-state'), 0o500);

    const res = await runStopGate(
      JSON.stringify({ session_id: sessionId, cwd: PROJECT_ROOT }),
      {
        HOOK_PLATFORM: 'claude',
        QUALITY_GATE_GLOBAL_CONFIG_PATH: join(import.meta.dir, 'workflow-gates-enabled.yaml'),
      },
    );
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain('"decision":"block"');
  });
});
