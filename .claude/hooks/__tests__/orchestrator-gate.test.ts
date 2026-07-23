import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { join } from 'path';
import { Readable } from 'stream';
import { isOrchestrator, isReadTool, isWriteTool, main as orchestratorMain } from '../orchestrator-gate.js';
import { clearGateConfigCache } from '../gate-config.js';
import { expectAllow, expectDeny, PROJECT_ROOT } from './helpers.js';

describe('orchestrator-gate helpers', () => {
  it('isOrchestrator when no agent_id', () => {
    expect(isOrchestrator({})).toBe(true);
    expect(isOrchestrator({ agent_id: 'ship-sa-1' })).toBe(false);
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

  it('denies orchestrator Write', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'foo.ts' },
        session_id: 'orch-test',
        cwd: PROJECT_ROOT,
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

  it('allows Shell (not handled by orchestrator-gate)', async () => {
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

  it('allows orchestrator Read (agent_id omitted)', async () => {
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

  it('allows orchestrator Write to _bmad-output/ (agent_id omitted)', async () => {
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
});
