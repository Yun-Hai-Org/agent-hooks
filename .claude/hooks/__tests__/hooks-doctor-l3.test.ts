import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync, execSync } from 'child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PROJECT_ROOT } from './helpers.js';

interface DoctorReport {
  ok: boolean;
  errors: number;
  repaired: boolean;
  messages: string[];
}

const DOCTOR_SCRIPT = join(PROJECT_ROOT, 'scripts/hooks-doctor.sh');
const MANIFEST_PATH = join(PROJECT_ROOT, '.cursor/hooks-manifest.json');

function readManifest(): { gitHooks: { globalPath: string; requiredHooks: string[] } } {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
    gitHooks: { globalPath: string; requiredHooks: string[] };
  };
}

function runDoctor(
  args: string[],
  env: Record<string, string>,
  hooksRepo = PROJECT_ROOT,
): { code: number | null; report: DoctorReport; stderr: string } {
  const result = spawnSync('bash', [DOCTOR_SCRIPT, ...args, hooksRepo], {
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
  const jsonLine = (result.stdout ?? '')
    .trim()
    .split('\n')
    .reverse()
    .find((line) => line.startsWith('{'));
  const report = JSON.parse(jsonLine ?? '{}') as DoctorReport;
  return { code: result.status, report, stderr: result.stderr ?? '' };
}

function setupIsolatedHome(): { home: string; gitHooksDir: string; gitconfig: string; cleanup: () => void } {
  const home = join(tmpdir(), `hooks-doctor-l3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(home, { recursive: true });
  const gitHooksDir = join(home, '.git-hooks');
  mkdirSync(gitHooksDir, { recursive: true });

  for (const hook of readManifest().gitHooks.requiredHooks) {
    const hookPath = join(gitHooksDir, hook);
    writeFileSync(hookPath, '#!/bin/sh\nexit 0\n');
    chmodSync(hookPath, 0o755);
  }

  const gitconfig = join(home, '.gitconfig');
  writeFileSync(gitconfig, `[core]\n\thooksPath = ${gitHooksDir}\n`);

  return {
    home,
    gitHooksDir,
    gitconfig,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function doctorEnv(home: string, gitconfig: string): Record<string, string> {
  return {
    HOME: home,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
}

function createStrategyBRepo(): { repo: string; cleanup: () => void } {
  const repo = join(tmpdir(), '20260531-hooks');
  if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  mkdirSync(join(repo, '.cursor'), { recursive: true });
  mkdirSync(join(repo, '.claude/hooks'), { recursive: true });
  cpSync(MANIFEST_PATH, join(repo, '.cursor/hooks-manifest.json'));
  execSync('git init -b main', { cwd: repo, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  return { repo, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe('hooks-doctor L3 git hooks detection', () => {
  it('passes L3 when global core.hooksPath and required hooks exist', () => {
    const { home, gitconfig, cleanup } = setupIsolatedHome();
    cleanups.push(cleanup);

    const { report } = runDoctor(['--json', '--quiet'], doctorEnv(home, gitconfig));
    expect(report.messages.some((m) => m.includes('L3 git hooks integrity passed'))).toBe(true);
    expect(report.messages.some((m) => m.includes('L3 global core.hooksPath not set'))).toBe(false);
  });

  it('reports L3 ERROR when global core.hooksPath is unset', () => {
    const { home, gitconfig, cleanup } = setupIsolatedHome();
    writeFileSync(gitconfig, '[core]\n');
    cleanups.push(cleanup);

    const { code, report } = runDoctor(['--json', '--quiet'], doctorEnv(home, gitconfig));
    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.messages.some((m) => m.includes('L3 global core.hooksPath not set'))).toBe(true);
  });

  it('reports L3 ERROR when a required global hook file is missing', () => {
    const { home, gitHooksDir, gitconfig, cleanup } = setupIsolatedHome();
    rmSync(join(gitHooksDir, 'pre-commit'), { force: true });
    cleanups.push(cleanup);

    const { code, report } = runDoctor(['--json', '--quiet'], doctorEnv(home, gitconfig));
    expect(code).toBe(1);
    expect(report.messages.some((m) => m.includes('L3 missing global git hook'))).toBe(true);
  });

  it('reports L3 hooks_trap when core.hooksPath points at sample-only .git/hooks', () => {
    const { home, gitconfig, cleanup } = setupIsolatedHome();
    const trapDir = join(home, 'repo', '.git', 'hooks');
    mkdirSync(trapDir, { recursive: true });
    writeFileSync(join(trapDir, 'pre-commit.sample'), '# sample only\n');
    writeFileSync(gitconfig, `[core]\n\thooksPath = ${trapDir}\n`);
    cleanups.push(cleanup);

    const { code, report } = runDoctor(['--json', '--quiet'], doctorEnv(home, gitconfig));
    expect(code).toBe(1);
    expect(report.messages.some((m) => m.includes('L3 hooks_trap'))).toBe(true);
  });

  it('reports L3 ERROR for strategy B repo with local core.hooksPath set', () => {
    const { home, gitconfig, cleanup: homeCleanup } = setupIsolatedHome();
    const { repo, cleanup: repoCleanup } = createStrategyBRepo();
    cleanups.push(homeCleanup, repoCleanup);

    execSync('git config --local core.hooksPath .git/hooks', { cwd: repo, stdio: 'pipe' });

    const { report } = runDoctor(['--json', '--quiet'], doctorEnv(home, gitconfig), repo);
    expect(
      report.messages.some((m) => m.includes('L3 strategy B repo local core.hooksPath must be unset')),
    ).toBe(true);
  });
});
