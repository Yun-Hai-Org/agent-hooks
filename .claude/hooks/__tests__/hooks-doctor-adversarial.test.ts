import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync, execSync } from 'child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
const LINK_SCRIPT = join(PROJECT_ROOT, 'scripts/link-cursor-hooks-global.sh');
const MANIFEST_PATH = join(PROJECT_ROOT, '.cursor/hooks-manifest.json');

function readRequiredHooks(): string[] {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
    gitHooks: { requiredHooks: string[] };
  };
  return manifest.gitHooks.requiredHooks;
}

function setupTempHome(): { home: string; gitconfig: string; cleanup: () => void } {
  const home = join(tmpdir(), `hooks-doctor-adv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, '.cursor'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });

  const gitHooksDir = join(home, '.git-hooks');
  mkdirSync(gitHooksDir, { recursive: true });
  for (const hook of readRequiredHooks()) {
    const hookPath = join(gitHooksDir, hook);
    writeFileSync(hookPath, '#!/bin/sh\nexit 0\n');
    chmodSync(hookPath, 0o755);
  }

  const gitconfig = join(home, '.gitconfig');
  writeFileSync(gitconfig, `[core]\n\thooksPath = ${gitHooksDir}\n`);

  return {
    home,
    gitconfig,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function isolatedEnv(home: string, gitconfig: string): Record<string, string> {
  return {
    HOME: home,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
}

function runDoctor(args: string[], env: Record<string, string>): DoctorReport {
  const result = spawnSync('bash', [DOCTOR_SCRIPT, ...args, PROJECT_ROOT], {
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
  const jsonLine = (result.stdout ?? '')
    .trim()
    .split('\n')
    .reverse()
    .find((line) => line.startsWith('{'));
  return JSON.parse(jsonLine ?? '{}') as DoctorReport;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe('hooks-doctor adversarial repair', () => {
  it('restores ~/.cursor/hooks.json symlink after --repair (isolated HOME)', () => {
    const { home, gitconfig, cleanup } = setupTempHome();
    cleanups.push(cleanup);
    const env = isolatedEnv(home, gitconfig);

    execSync(`bash "${LINK_SCRIPT}" "${PROJECT_ROOT}"`, { env, stdio: 'pipe' });

    const hooksJson = join(home, '.cursor/hooks.json');
    expect(existsSync(hooksJson)).toBe(true);
    rmSync(hooksJson, { force: true });
    expect(existsSync(hooksJson)).toBe(false);

    const report = runDoctor(['--repair', '--json', '--quiet'], env);
    expect(report.repaired).toBe(true);
    expect(existsSync(hooksJson)).toBe(true);
    expect(lstatSync(hooksJson).isSymbolicLink()).toBe(true);
  });
});
