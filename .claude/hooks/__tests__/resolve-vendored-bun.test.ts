import { describe, it, expect } from 'bun:test';
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { PROJECT_ROOT } from './helpers.js';

const RESOLVE_SCRIPT = join(PROJECT_ROOT, 'scripts/lib/resolve-vendored-bun.sh');
const LINK_SCRIPT = join(PROJECT_ROOT, 'scripts/link-cursor-hooks-global.sh');

function gitCommonDir(cwd: string): string {
  let common = execSync('git rev-parse --git-common-dir', { cwd, encoding: 'utf-8' }).trim();
  if (!common.startsWith('/')) {
    common = join(cwd, common);
  }
  return common;
}

function bareRepoRoot(worktree: string): string {
  return dirname(gitCommonDir(worktree));
}

function sourceAndRun(fn: string, repo: string): { code: number | null; stdout: string } {
  const script = `
    set -euo pipefail
    source "${RESOLVE_SCRIPT}"
    ${fn} "${repo}"
  `;
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
  return { code: result.status, stdout: (result.stdout ?? '').trim() };
}

describe('resolve-vendored-bun', () => {
  const bare = bareRepoRoot(PROJECT_ROOT);
  const worktree = PROJECT_ROOT;
  const expectedBun = join(bare, '.tools/bun-darwin-x64/bun');

  it('worktree 无 .tools 时解析到 bare vendored bun', () => {
    expect(existsSync(expectedBun)).toBe(true);
    expect(existsSync(join(worktree, '.tools/bun-darwin-x64/bun'))).toBe(false);

    const { code, stdout } = sourceAndRun('resolve_vendored_bun_path', worktree);
    expect(code).toBe(0);
    expect(stdout).toBe(expectedBun);
  });

  it('resolve_hooks_repo_root 从 worktree 上溯 bare 根', () => {
    const { code, stdout } = sourceAndRun('resolve_hooks_repo_root', worktree);
    expect(code).toBe(0);
    expect(stdout).toBe(bare);
  });

  it('HOOKS_REPO 直接为 bare 时返回自身 bun 路径', () => {
    const { code, stdout } = sourceAndRun('resolve_vendored_bun_path', bare);
    expect(code).toBe(0);
    expect(stdout).toBe(expectedBun);
  });
});

describe('link-cursor-hooks-global bun link', () => {
  it('从 worktree 运行 link 后 ~/.cursor/bun 可执行', () => {
    const home = execSync('mktemp -d', { encoding: 'utf-8' }).trim();

    try {
      const result = spawnSync('bash', [LINK_SCRIPT, PROJECT_ROOT], {
        env: { ...process.env, HOME: home },
        encoding: 'utf-8',
      });
      if (result.status !== 0) {
        throw new Error(`link failed: ${result.stderr}\n${result.stdout}`);
      }

      const linkedBun = join(home, '.cursor/bun');
      expect(existsSync(linkedBun)).toBe(true);
      const version = execSync(`"${linkedBun}" --version`, { encoding: 'utf-8' }).trim();
      expect(version.length).toBeGreaterThan(0);
    } finally {
      spawnSync('rm', ['-rf', home]);
    }
  });
});
