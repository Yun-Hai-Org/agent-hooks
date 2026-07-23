import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { isFeatBranch, isWorktreeBootstrapCommand, main as worktreeMain } from '../worktree-gate.js';
import { isInsideWorktree } from '../branch-gate.js';
import { clearGateConfigCache } from '../gate-config.js';
import { expectAllow, expectDeny, PROJECT_ROOT, createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('worktree-gate helpers', () => {
  it('isFeatBranch accepts feat/* and task branches', () => {
    expect(isFeatBranch('feat/foo')).toBe(true);
    expect(isFeatBranch('feat/hooks-restore-workflow-p2-json')).toBe(true);
    expect(isFeatBranch('master')).toBe(false);
  });

  it('isWorktreeBootstrapCommand allows git worktree add', () => {
    expect(isWorktreeBootstrapCommand('git worktree add .worktrees/x -b feat/x')).toBe(true);
    expect(isWorktreeBootstrapCommand('git status')).toBe(false);
  });
});

describe('isInsideWorktree', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join('/tmp', `wt-gate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true when .git is a file (worktree)', () => {
    writeFileSync(join(tempDir, '.git'), 'gitdir: /path/to/main/.git/worktrees/foo\n', 'utf8');
    expect(isInsideWorktree(tempDir)).toBe(true);
  });

  it('returns false when .git is a directory (main checkout)', () => {
    mkdirSync(join(tempDir, '.git'));
    expect(isInsideWorktree(tempDir)).toBe(false);
  });
});

describe('worktree-gate main()', () => {
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

  it('allows non Write/Shell tools', async () => {
    process.stdin = Readable.from([
      JSON.stringify({ tool_name: 'Read', tool_input: {}, session_id: 's1', cwd: PROJECT_ROOT }),
    ]);
    await worktreeMain();
    expect(output).toHaveLength(1);
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('denies Write on main checkout when gate enabled', async () => {
    const repoDir = createTempGitRepo('main');
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: 'foo.txt', content: 'x' },
          session_id: 's2',
          cwd: repoDir,
        }),
      ]);
      await worktreeMain();
      expect(output).toHaveLength(1);
      expect(expectDeny(output[0]!)).toBe(true);
    } finally {
      cleanupTempGitRepo(repoDir);
    }
  });

  it('allows git worktree add bootstrap shell', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'git worktree add .worktrees/feat-x -b feat/x' },
        session_id: 's3',
        cwd: PROJECT_ROOT,
      }),
    ]);
    await worktreeMain();
    expect(output).toHaveLength(1);
    expect(expectAllow(output[0]!)).toBe(true);
  });

  it('allows Write inside feat worktree', async () => {
    const tempDir = join('/tmp', `wt-main-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, '.git'), 'gitdir: /path/to/main/.git/worktrees/foo\n', 'utf8');
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: 'a.ts', content: 'x' },
          session_id: 's4',
          cwd: tempDir,
        }),
      ]);
      await worktreeMain();
      expect(output).toHaveLength(1);
      expect(expectAllow(output[0]!)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows Write to _bmad-output/ on main checkout', async () => {
    const repoDir = createTempGitRepo('main');
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: '_bmad-output/x.md', content: 'x' },
          session_id: 's5',
          cwd: repoDir,
        }),
      ]);
      await worktreeMain();
      expect(output).toHaveLength(1);
      expect(expectAllow(output[0]!)).toBe(true);
    } finally {
      cleanupTempGitRepo(repoDir);
    }
  });

  it('allows Shell write to _bmad-output/ on main checkout', async () => {
    const repoDir = createTempGitRepo('main');
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: "cat <<'EOF' > _bmad-output/x.md" },
          session_id: 's6',
          cwd: repoDir,
        }),
      ]);
      await worktreeMain();
      expect(output).toHaveLength(1);
      expect(expectAllow(output[0]!)).toBe(true);
    } finally {
      cleanupTempGitRepo(repoDir);
    }
  });
});
