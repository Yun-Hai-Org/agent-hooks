import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { main as mergeGateMain } from '../merge-gate.js';
import { main as pushGateMain } from '../push-gate.js';
import {
  runShellTests,
  runHookUnitTests,
  runHookAdversarialTests,
  runHookAdversarialIfStaged,
  runFullProjectTests,
  runRelatedTests,
} from '../checks/tests.js';
import {
  extractCommitMessage,
  buildUncommittedWorktreeDenyReason,
  isGitMergeCommand,
  isGitPushCommand,
} from '../checks/git-policy.js';
import { extractMergeTarget } from '../merge-gate.js';
import { clearGateConfigCache, loadGateConfig } from '../gate-config.js';
import { createTempGitRepo, cleanupTempGitRepo, expectAllow, PROJECT_ROOT } from './helpers.js';
import { DECISION } from '../security-orchestrator.js';

function createMinimalHooksProject(branch = 'feat/stub'): string {
  const repo = createTempGitRepo(branch);
  mkdirSync(join(repo, '.claude/hooks/__tests__/adversarial'), { recursive: true });
  writeFileSync(join(repo, '.claude/hooks/quality-gate.ts'), 'export {};\n');
  writeFileSync(
    join(repo, '.claude/hooks/__tests__/stub.test.ts'),
    `import { it, expect } from 'bun:test';\nit('stub', () => { expect(1).toBe(1); });\n`,
  );
  writeFileSync(
    join(repo, '.claude/hooks/__tests__/adversarial/stub.test.ts'),
    `import { it, expect } from 'bun:test';\nit('adv', () => { expect(true).toBe(true); });\n`,
  );
  writeFileSync(join(repo, '.claude/hooks/__tests__/empty-global-quality-gate.yaml'), 'settings: {}\n');
  return repo;
}

describe('merge-gate / push-gate smoke', () => {
  let originalStdin: typeof process.stdin;
  let originalConsoleLog: typeof console.log;
  let logs: string[];

  beforeEach(() => {
    originalStdin = process.stdin;
    originalConsoleLog = console.log;
    logs = [];
    console.log = (msg?: unknown) => {
      logs.push(String(msg ?? ''));
    };
  });

  afterEach(() => {
    process.stdin = originalStdin;
    console.log = originalConsoleLog;
  });

  it('merge-gate 非 Shell 输入 allow', async () => {
    process.stdin = Readable.from([
      JSON.stringify({ tool_name: 'Read', tool_input: {}, session_id: 'm1', cwd: PROJECT_ROOT }),
    ]);
    await mergeGateMain();
    expect(logs.some((line) => expectAllow(line))).toBe(true);
  });

  it('merge-gate 非 merge 命令 allow', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'git status' },
        session_id: 'm2',
        cwd: PROJECT_ROOT,
      }),
    ]);
    await mergeGateMain();
    expect(logs.some((line) => expectAllow(line))).toBe(true);
  });

  it('push-gate 非 Shell 输入 allow', async () => {
    process.stdin = Readable.from([
      JSON.stringify({ tool_name: 'Read', tool_input: {}, session_id: 'p1', cwd: PROJECT_ROOT }),
    ]);
    await pushGateMain();
    expect(logs.some((line) => expectAllow(line))).toBe(true);
  });

  it('push-gate 非 push 命令 allow', async () => {
    process.stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Shell',
        tool_input: { command: 'git commit -m "chore: x"' },
        session_id: 'p2',
        cwd: PROJECT_ROOT,
      }),
    ]);
    await pushGateMain();
    expect(logs.some((line) => expectAllow(line))).toBe(true);
  });

  it('merge-gate extractMergeTarget 经模块 re-export', () => {
    expect(extractMergeTarget('git merge feat/x')).toBe('feat/x');
    expect(isGitMergeCommand('git merge feat/x')).toBe(true);
    expect(isGitPushCommand('git push origin main')).toBe(true);
  });
});

describe('checks/tests branches', () => {
  let stubRepo = '';
  let origGlob: string | undefined;

  beforeEach(() => {
    stubRepo = createMinimalHooksProject();
    origGlob = process.env['HOOK_UNIT_TEST_GLOB'];
    process.env['HOOK_UNIT_TEST_GLOB'] = './.claude/hooks/__tests__/stub.test.ts';
  });

  afterEach(() => {
    if (origGlob === undefined) delete process.env['HOOK_UNIT_TEST_GLOB'];
    else process.env['HOOK_UNIT_TEST_GLOB'] = origGlob;
    if (stubRepo) cleanupTempGitRepo(stubRepo);
    stubRepo = '';
  });

  it('runShellTests 无 tests/shell SKIP', async () => {
    const r = await runShellTests(stubRepo);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runHookUnitTests stub 项目 ALLOW', async () => {
    const r = await runHookUnitTests(stubRepo);
    expect(r.decision).toBe(DECISION.ALLOW);
  }, 60_000);

  it('runHookUnitTests stub 项目 coverage 路径可执行', async () => {
    const r = await runHookUnitTests(stubRepo, { coverageThreshold: { lines: 1, functions: 1 } });
    expect([DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
  }, 60_000);

  it('runHookAdversarialTests stub 项目 ALLOW', async () => {
    const r = await runHookAdversarialTests(stubRepo);
    expect(r.decision).toBe(DECISION.ALLOW);
  }, 60_000);

  it('runHookAdversarialIfStaged 未暂存 hooks SKIP', async () => {
    const r = await runHookAdversarialIfStaged(stubRepo);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runRelatedTests 无暂存 SKIP', async () => {
    const r = await runRelatedTests(stubRepo);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runFullProjectTests stub 仓库', async () => {
    const r = await runFullProjectTests(stubRepo);
    expect([DECISION.SKIP, DECISION.ALLOW]).toContain(r.decision);
  });
});

describe('git-policy branches', () => {
  it('extractCommitMessage heredoc 与单引号', () => {
    expect(extractCommitMessage("git commit -m 'feat: ok'")).toBe('feat: ok');
    expect(extractCommitMessage(`git commit -m "$(cat <<'EOF'\nfeat: heredoc\nEOF\n)"`)).toBe('feat: heredoc');
    expect(extractCommitMessage('git commit -m wip')).toBe('wip');
  });

  it('buildUncommittedWorktreeDenyReason 含步骤', () => {
    const repo = createTempGitRepo('feat/wip');
    writeFileSync(join(repo, 'dirty.txt'), 'x\n');
    try {
      const msg = buildUncommittedWorktreeDenyReason(repo, 'push');
      expect(msg).toContain('git push');
      expect(msg).toContain('feat/wip');
    } finally {
      cleanupTempGitRepo(repo);
    }
  });
});

describe('gate-config settings merge', () => {
  let repoDir = '';

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/merge-settings');
    clearGateConfigCache();
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'workflow-gates-enabled.yaml');
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
  });

  it('deep merge settings 含 notifications 与 coverage 子项', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  coverageThreshold:
    lines: 82
  diffCoverageThreshold:
    lines: 81
    enforceOn:
      - push
  testFilePairing:
    enabled: true
  coreModuleCoverage:
    lines: 91
  securityRuleCoverage:
    requiredPercent: 100
  scanScope:
    include:
      - src/**
  pushMergeBranches:
    mode: all
  licenseDenylist:
    - MIT
  notifications:
    channels:
      wechat:
        url: https://example.com/hook
`,
    );
    clearGateConfigCache();
    const config = loadGateConfig(repoDir);
    expect(config.settings?.coverageThreshold).toEqual({ lines: 82 });
    expect(config.settings?.diffCoverageThreshold?.lines).toBe(81);
    expect(config.settings?.notifications?.channels?.wechat?.url).toBe('https://example.com/hook');
    expect(config.settings?.licenseDenylist).toContain('MIT');
  });
});
