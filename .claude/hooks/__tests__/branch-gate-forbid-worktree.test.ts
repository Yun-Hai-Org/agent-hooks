import { describe, it, expect, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { clearGateConfigCache } from '../gate-config.js';
import { main } from '../branch-gate.js';
import { disableGlobalGitHooks } from './helpers.js';

function writeWorktreeGateYaml(repoDir: string, forbidCreateFromMain: boolean): void {
  const content = [
    'ide:',
    '  branch-gate:',
    '    enabled: true',
    'settings:',
    '  worktree:',
    `    forbidCreateFromMain: ${forbidCreateFromMain}`,
  ].join('\n');
  mkdirSync(join(repoDir, '.claude'), { recursive: true });
  writeFileSync(join(repoDir, '.claude/quality-gate.yaml'), content, 'utf-8');
  clearGateConfigCache();
}

describe('branch-gate forbidCreateFromMain', () => {
  let tempDir = '';
  let output: string[] = [];

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
    output = [];
  });

  async function runWorktreeAdd(forbidCreateFromMain: boolean): Promise<string> {
    tempDir = join('/tmp', `branch-gate-wt-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    execSync('git init -b main', { cwd: tempDir, stdio: 'pipe' });
    disableGlobalGitHooks(tempDir);
    writeWorktreeGateYaml(tempDir, forbidCreateFromMain);

    output = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    };
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk.trimEnd() : Buffer.from(chunk).toString().trimEnd());
      return true;
    }) as typeof process.stdout.write;

    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'git worktree add .worktrees/feat-x -b feat/x' },
        session_id: 'forbid-wt-test',
        cwd: tempDir,
      }),
    ]);
    await main();
    console.log = originalConsoleLog;
    return output.at(-1) ?? '{}';
  }

  it('denies git worktree add on main when forbidCreateFromMain is true', async () => {
    const result = await runWorktreeAdd(true);
    const parsed = JSON.parse(result);
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput?.permissionDecisionReason).toContain('forbidCreateFromMain');
  });

  it('allows git worktree add on main when forbidCreateFromMain is false', async () => {
    const result = await runWorktreeAdd(false);
    expect(result).toBe('{}');
  });
});
