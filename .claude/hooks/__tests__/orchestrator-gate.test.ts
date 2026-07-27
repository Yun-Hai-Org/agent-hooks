import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { join } from 'path';
import { Readable } from 'stream';
import { isOrchestratorInWorkflow } from '../hook-adapter.js';
import { defaultWorkflowState, mergeTodoWriteItems } from '../workflow-state.js';
import { isReadTool, isWriteTool, main as orchestratorMain } from '../orchestrator-gate.js';
import { clearGateConfigCache } from '../gate-config.js';
import { expectAllow, expectDeny, PROJECT_ROOT } from './helpers.js';

describe('orchestrator-gate helpers', () => {
  it('isOrchestratorInWorkflow derives mode from agent_id/state', () => {
    const idle = defaultWorkflowState();
    const active = mergeTodoWriteItems(defaultWorkflowState(), [{ id: '1', content: 'x', status: 'pending' }]);
    expect(isOrchestratorInWorkflow({}, idle)).toBe(false);
    expect(isOrchestratorInWorkflow({}, active)).toBe(true);
    expect(isOrchestratorInWorkflow({ agent_id: 'ship-sa-1' }, active)).toBe(false);
    expect(isOrchestratorInWorkflow({ agent_mode: 'orchestrator' }, idle)).toBe(true);
  });

  it('tool kind detection', () => {
    expect(isReadTool('Read')).toBe(true);
    expect(isWriteTool('Write')).toBe(true);
    expect(isReadTool('Shell')).toBe(false);
  });
});

describe('orchestrator-gate main()', () => {
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

  it('allows ask-mode Write (agent_id omitted, no todos)', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts' },
        session_id: 'orch-test',
        cwd: PROJECT_ROOT,
        agent_mode: 'ask',
      }),
    ]);
    await orchestratorMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('denies orchestrator-mode Write', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts' },
        session_id: 'orch-test',
        cwd: PROJECT_ROOT,
        agent_mode: 'orchestrator',
      }),
    ]);
    await orchestratorMain();
    expect(expectDeny(output[0]!)).toBe(true);
    expect(output[0]).toContain('orchestrator-gate');
  });

  it('allows subagent Read', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'foo.ts' },
        session_id: 'orch-test',
        cwd: PROJECT_ROOT,
        agent_id: 'explore-sa',
      }),
    ]);
    await orchestratorMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('allows orchestrator non-write shell (git status)', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'git status' },
        session_id: 'orch-test',
        cwd: PROJECT_ROOT,
      }),
    ]);
    await orchestratorMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('allows ask-mode Read of any file (agent_id omitted)', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'foo.ts' },
        session_id: 'orch-test',
        cwd: PROJECT_ROOT,
      }),
    ]);
    await orchestratorMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('allows ask-mode Write to _bmad-output planning artifact (agent_id omitted)', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '_bmad-output/spec.md' },
        session_id: 'orch-test',
        cwd: PROJECT_ROOT,
      }),
    ]);
    await orchestratorMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('denies orchestrator shell file write (sed -i)', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'sed -i "s/old/new/" file.txt' },
        session_id: 'orch-test',
        cwd: PROJECT_ROOT,
      }),
    ]);
    await orchestratorMain();
    expect(expectDeny(output[0]!)).toBe(true);
    expect(output[0]).toContain('orchestrator-gate');
    expect(output[0]).toContain('Shell');
    expect(output[0]).toContain('sed 原地编辑');
  });

  it('allows subagent shell file write', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'sed -i "s/old/new/" file.txt' },
        session_id: 'orch-test',
        cwd: PROJECT_ROOT,
        agent_id: 'impl-sa-1',
      }),
    ]);
    await orchestratorMain();
    expect(expectAllow(output[0]!)).toBe(true);
  });
});
