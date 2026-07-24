import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { join } from 'path';
import { Readable } from 'stream';
import { isGitShipWriteCommand, isShipAgent, main as gitShipMain } from '../git-ship-gate.js';
import { clearGateConfigCache } from '../gate-config.js';
import { saveWorkflowState, defaultWorkflowState } from '../workflow-state.js';
import { expectAllow, expectDeny, PROJECT_ROOT } from './helpers.js';

describe('git-ship-gate helpers', () => {
  it('detects git ship write commands', () => {
    expect(isGitShipWriteCommand('git commit -m "feat: x"')).toBe(true);
    expect(isGitShipWriteCommand('git push origin feat/x')).toBe(true);
    expect(isGitShipWriteCommand('git merge --no-ff feat/x')).toBe(true);
    expect(isGitShipWriteCommand('git checkout main')).toBe(true);
    expect(isGitShipWriteCommand('gh pr create --title x')).toBe(true);
    expect(isGitShipWriteCommand('git status')).toBe(false);
    expect(isGitShipWriteCommand('git worktree list')).toBe(false);
  });

  it('isShipAgent from agent_role', () => {
    const sessionId = `ship-role-${Date.now()}`;
    saveWorkflowState(sessionId, { ...defaultWorkflowState(), agent_role: 'merge-sa' });
    expect(isShipAgent({ agent_id: 'sa-1' }, sessionId)).toBe(true);
    expect(isShipAgent({ agent_id: 'sa-1', description: 'impl task' }, sessionId)).toBe(true);
    expect(isShipAgent({ agent_id: 'sa-2', subagent_type: 'generalPurpose' }, 'other-session')).toBe(false);
  });
});

describe('git-ship-gate main()', () => {
  let originalStdin: typeof process.stdin;
  let originalStdoutWrite: typeof process.stdout.write;
  let output: string[];

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    output = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk.trimEnd() : Buffer.from(chunk).toString().trimEnd());
      return true;
    }) as typeof process.stdout.write;
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'workflow-gates-enabled.yaml');
    clearGateConfigCache();
  });

  afterEach(() => {
    process.stdin = originalStdin;
    process.stdout.write = originalStdoutWrite;
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
  });

  it('allows ask-mode git commit (not treated as orchestrator)', async () => {
    const sessionId = `ship-ask-${Date.now()}`;
    saveWorkflowState(sessionId, defaultWorkflowState());
    process.stdin = Readable.from([
      JSON.stringify({
        command: 'git commit -m "feat: x"',
        session_id: sessionId,
        cwd: PROJECT_ROOT,
        agent_mode: 'ask',
      }),
    ]);
    await gitShipMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('denies orchestrator-mode git commit', async () => {
    const sessionId = `ship-orch-${Date.now()}`;
    saveWorkflowState(sessionId, defaultWorkflowState());
    process.stdin = Readable.from([
      JSON.stringify({
        command: 'git commit -m "feat: x"',
        session_id: sessionId,
        cwd: PROJECT_ROOT,
        agent_mode: 'orchestrator',
      }),
    ]);
    await gitShipMain();
    expect(expectDeny(output[0]!)).toBe(true);
    expect(output[0]).toContain('git-ship-gate');
  });

  it('allows ship-sa git commit', async () => {
    const sessionId = `ship-sa-${Date.now()}`;
    saveWorkflowState(sessionId, { ...defaultWorkflowState(), agent_role: 'ship-sa' });
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'git commit -m "feat: x"' },
        session_id: sessionId,
        cwd: PROJECT_ROOT,
        agent_id: 'ship-sa-1',
        agent_role: 'ship-sa',
      }),
    ]);
    await gitShipMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('allows ship-sa git commit via beforeShellExecution without agent_id', async () => {
    const sessionId = `ship-sync-no-agent-${Date.now()}`;
    saveWorkflowState(sessionId, { ...defaultWorkflowState(), agent_role: 'ship-sa' });
    process.stdin = Readable.from([
      JSON.stringify({ command: 'git commit -m "feat: x"', session_id: sessionId, cwd: PROJECT_ROOT }),
    ]);
    await gitShipMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('denies impl subagent git push', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'git push origin feat/x' },
        session_id: 'impl-test',
        cwd: PROJECT_ROOT,
        agent_id: 'impl-sa-1',
        subagent_type: 'generalPurpose',
      }),
    ]);
    await gitShipMain();
    expect(expectDeny(output[0]!)).toBe(true);
  });

  it('allows git status for orchestrator', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        command: 'git status',
        session_id: 'ship-test',
        cwd: PROJECT_ROOT,
      }),
    ]);
    await gitShipMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });
});
