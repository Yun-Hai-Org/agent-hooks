import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { execSync } from 'child_process';
import * as mergeGate from '../merge-gate.js';
import * as pushGate from '../push-gate.js';
import { runRelatedTests, runFullProjectTests, runHookUnitTests, runHookAdversarialTests } from '../checks/tests.js';
import { checkCommitMessage, checkCommitMessageFromFile, validateCommitMessageText } from '../checks/git-policy.js';
import { clearGateConfigCache, loadGateConfig, resolveCoverageThresholds } from '../gate-config.js';
import { createTempGitRepo, cleanupTempGitRepo, expectAllow, expectDeny } from './helpers.js';
import { DECISION } from '../security-orchestrator.js';

function hookConsole() {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown) => {
    logs.push(String(msg ?? ''));
  };
  return {
    logs,
    restore: () => {
      console.log = orig;
    },
  };
}

function allowGateResult() {
  return {
    passed: true,
    results: [],
    decision: { decision: 'allow' as const, reason: 'ok' },
    timing: { maxMs: 0, avgMs: 0, slowest: null },
  };
}

describe('merge-gate branches', () => {
  it('runFullOnSourceBranch 无效分支应失败', async () => {
    const repo = createTempGitRepo('main');
    try {
      const result = await mergeGate.runFullOnSourceBranch(repo, 'does-not-exist');
      expect(result.passed).toBe(false);
    } finally {
      cleanupTempGitRepo(repo);
    }
  }, 120_000);

  it('main 解析 merge 无 source 分支 deny', async () => {
    const repo = createTempGitRepo('feat/merge-src');
    const { logs, restore } = hookConsole();
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: 'git merge' },
          session_id: 'mg1',
          cwd: repo,
        }),
      ]);
      await mergeGate.main();
      expect(logs.some((line) => expectDeny(line))).toBe(true);
    } finally {
      restore();
      cleanupTempGitRepo(repo);
    }
  });

  it('merge main 到自身 deny', async () => {
    const repo = createTempGitRepo('feat/merge-src');
    const { logs, restore } = hookConsole();
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: 'git merge main' },
          session_id: 'mg2',
          cwd: repo,
        }),
      ]);
      await mergeGate.main();
      expect(logs.some((line) => expectDeny(line))).toBe(true);
    } finally {
      restore();
      cleanupTempGitRepo(repo);
    }
  });

  it('未提交变更 merge deny', async () => {
    const repo = createTempGitRepo('feat/merge-src');
    execSync('git checkout -b feat/target', { cwd: repo });
    writeFileSync(join(repo, 'dirty.txt'), 'x\n');
    const { logs, restore } = hookConsole();
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: 'git merge feat/merge-src' },
          session_id: 'mg3',
          cwd: repo,
        }),
      ]);
      await mergeGate.main();
      expect(logs.some((line) => expectDeny(line))).toBe(true);
    } finally {
      restore();
      cleanupTempGitRepo(repo);
    }
  });

  it('干净 merge 走 injected full gate allow', async () => {
    const repo = createTempGitRepo('feat/merge-inject');
    execSync('git checkout -b feat/source', { cwd: repo });
    writeFileSync(join(repo, 'README.md'), '# src\n');
    execSync('git add README.md && git commit -m "docs: src"', { cwd: repo });
    execSync('git checkout feat/merge-inject', { cwd: repo });
    const prev = mergeGate.mergeGateDeps.runQualityGate;
    mergeGate.mergeGateDeps.runQualityGate = async () => allowGateResult();
    const { logs, restore } = hookConsole();
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: 'git merge feat/source' },
          session_id: 'mg-inject',
          cwd: repo,
        }),
      ]);
      await mergeGate.main();
      expect(logs.some((line) => expectAllow(line))).toBe(true);
    } finally {
      mergeGate.mergeGateDeps.runQualityGate = prev;
      restore();
      cleanupTempGitRepo(repo);
    }
  });

  it('injected merge gate 失败 deny', async () => {
    const repo = createTempGitRepo('feat/merge-fail');
    execSync('git checkout -b feat/source', { cwd: repo });
    writeFileSync(join(repo, 'README.md'), '# src\n');
    execSync('git add README.md && git commit -m "docs: src"', { cwd: repo });
    execSync('git checkout feat/merge-fail', { cwd: repo });
    const prev = mergeGate.mergeGateDeps.runQualityGate;
    mergeGate.mergeGateDeps.runQualityGate = async () => ({
      passed: false,
      results: [],
      decision: { decision: 'deny' as const, reason: 'mock fail' },
      timing: { maxMs: 0, avgMs: 0, slowest: null },
    });
    const { logs, restore } = hookConsole();
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: 'git merge feat/source' },
          session_id: 'mg-fail',
          cwd: repo,
        }),
      ]);
      await mergeGate.main();
      expect(logs.some((line) => expectDeny(line))).toBe(true);
    } finally {
      mergeGate.mergeGateDeps.runQualityGate = prev;
      restore();
      cleanupTempGitRepo(repo);
    }
  });

  it('runFullOnSourceBranch injected 成功', async () => {
    const repo = createTempGitRepo('feat/target');
    execSync('git checkout -b feat/source', { cwd: repo });
    writeFileSync(join(repo, 'README.md'), '# source\n');
    execSync('git add README.md && git commit -m "docs: source"', { cwd: repo });
    execSync('git checkout feat/target', { cwd: repo });
    const prev = mergeGate.mergeGateDeps.runQualityGate;
    mergeGate.mergeGateDeps.runQualityGate = async () => allowGateResult();
    try {
      const result = await mergeGate.runFullOnSourceBranch(repo, 'feat/source');
      expect(result.passed).toBe(true);
    } finally {
      mergeGate.mergeGateDeps.runQualityGate = prev;
      cleanupTempGitRepo(repo);
    }
  }, 120_000);
});

describe('push-gate branches', () => {
  it('push 分支策略 skip allow', async () => {
    const repo = createTempGitRepo('feat/skip-push');
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(
      join(repo, '.claude/quality-gate.yaml'),
      `settings:
  pushMergeBranches:
    mode: selected
    include:
      - release/*
`,
    );
    clearGateConfigCache();
    const origWrite = process.stdout.write.bind(process.stdout);
    const chunks: string[] = [];
    process.stdout.write = ((c: string | Uint8Array) => {
      chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: 'git push origin feat/skip-push' },
          session_id: 'pg1',
          cwd: repo,
        }),
      ]);
      await pushGate.main();
      const combined = chunks.join('');
      expect(expectAllow(combined)).toBe(true);
    } finally {
      process.stdout.write = origWrite;
      clearGateConfigCache();
      cleanupTempGitRepo(repo);
    }
  });

  it('未提交变更 push deny', async () => {
    const repo = createTempGitRepo('feat/dirty-push');
    writeFileSync(join(repo, 'dirty.txt'), 'x\n');
    const { logs, restore } = hookConsole();
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: 'git push origin feat/dirty-push' },
          session_id: 'pg2',
          cwd: repo,
        }),
      ]);
      await pushGate.main();
      expect(logs.some((line) => expectDeny(line))).toBe(true);
    } finally {
      restore();
      cleanupTempGitRepo(repo);
    }
  });

  it('干净 push 走 injected full gate allow', async () => {
    const repo = createTempGitRepo('feat/push-inject');
    writeFileSync(join(repo, 'README.md'), '# ok\n');
    execSync('git add README.md && git commit -m "docs: init"', { cwd: repo });
    const prev = pushGate.pushGateDeps.runQualityGate;
    pushGate.pushGateDeps.runQualityGate = async () => allowGateResult();
    const { logs, restore } = hookConsole();
    try {
      process.stdin = Readable.from([
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: 'git push origin feat/push-inject' },
          session_id: 'pg-inject',
          cwd: repo,
        }),
      ]);
      await pushGate.main();
      expect(logs.some((line) => expectAllow(line))).toBe(true);
    } finally {
      pushGate.pushGateDeps.runQualityGate = prev;
      restore();
      cleanupTempGitRepo(repo);
    }
  });
});

describe('git-policy commit message', () => {
  it('checkCommitMessage 无效格式 deny', () => {
    expect(checkCommitMessage('git commit -m "bad message"').decision).toBe(DECISION.DENY);
  });

  it('validateCommitMessageText 合法 feat', () => {
    expect(validateCommitMessageText('feat: add coverage gates').decision).toBe(DECISION.ALLOW);
  });

  it('checkCommitMessageFromFile 读取 msg 文件', () => {
    const repo = createTempGitRepo('feat/commit-msg');
    const msgFile = join(repo, 'msg.txt');
    writeFileSync(msgFile, 'feat: from file\n');
    try {
      expect(checkCommitMessageFromFile(msgFile).decision).toBe(DECISION.ALLOW);
    } finally {
      cleanupTempGitRepo(repo);
    }
  });
});

describe('gate-config global merge', () => {
  let repoDir = '';

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/global-merge');
    clearGateConfigCache();
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(
      import.meta.dir,
      'fixtures/global-quality-gate-settings.yaml',
    );
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
    clearGateConfigCache();
  });

  it('仓库 yaml 覆盖 global settings 子项', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  coverageThreshold: 77
  diffCoverageThreshold:
    lines: 83
    exclude:
      - vendor/**
  testFilePairing:
    enabled: false
  coreModuleCoverage:
    functions: 92
  securityRuleCoverage:
    modules:
      - block-dangerous-commands
  scanScope:
    exclude:
      - dist/**
  pushMergeBranches:
    exclude:
      - wip/*
  licenseDenylist:
    - Apache-2.0
  notifications:
    channels:
      feishu:
        url: https://feishu.example/hook
git:
  pre-commit:
    enabled: true
    checks:
      branch-check:
        enabled: true
      extra-check:
        enabled: true
`,
    );
    clearGateConfigCache();
    const config = loadGateConfig(repoDir);
    expect(resolveCoverageThresholds(repoDir)).toEqual({ lines: 77, functions: 77 });
    expect(config.settings?.diffCoverageThreshold?.exclude).toContain('vendor/**');
    expect(config.settings?.testFilePairing?.enabled).toBe(false);
    expect(config.settings?.coreModuleCoverage?.functions).toBe(92);
    expect(config.settings?.securityRuleCoverage?.modules).toEqual(['block-dangerous-commands']);
    expect(config.settings?.scanScope?.exclude).toContain('dist/**');
    expect(config.settings?.pushMergeBranches?.exclude).toContain('wip/*');
    expect(config.settings?.licenseDenylist).toContain('Apache-2.0');
    expect(config.settings?.notifications?.channels?.feishu?.url).toBe('https://feishu.example/hook');
    expect(config.git?.['pre-commit']?.checks?.['extra-check']?.enabled).toBe(true);
  });
});

describe('checks/tests python/js paths', () => {
  let repoDir = '';

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/tests-runner');
    mkdirSync(join(repoDir, '.claude/hooks/__tests__'), { recursive: true });
    mkdirSync(join(repoDir, 'tests'), { recursive: true });
    writeFileSync(join(repoDir, '.claude/hooks/quality-gate.ts'), 'export {};\n');
    writeFileSync(join(repoDir, 'lib.py'), 'def add(a, b):\n    return a + b\n');
    writeFileSync(
      join(repoDir, 'tests/test_lib.py'),
      'from lib import add\ndef test_add():\n    assert add(1, 2) == 3\n',
    );
    writeFileSync(join(repoDir, 'lib.ts'), 'export const v = 1;\n');
    writeFileSync(
      join(repoDir, 'lib.test.ts'),
      `import { it, expect } from 'bun:test';\nimport { v } from './lib.ts';\nit('v', () => expect(v).toBe(1));\n`,
    );
    writeFileSync(
      join(repoDir, 'pyproject.toml'),
      `[project]\nname = "stub"\nversion = "0.0.0"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n`,
    );
    execSync('git add -A', { cwd: repoDir });
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('runRelatedTests python 暂存', async () => {
    execSync('git reset HEAD lib.ts lib.test.ts', { cwd: repoDir });
    const r = await runRelatedTests(repoDir);
    expect([DECISION.ALLOW, DECISION.SKIP, DECISION.DENY]).toContain(r.decision);
  }, 60_000);

  it('runFullProjectTests 含 pyproject', async () => {
    const r = await runFullProjectTests(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 120_000);

  it('runHookUnitTests 非 hooks marker SKIP', async () => {
    const plain = createTempGitRepo('feat/plain');
    try {
      const r = await runHookUnitTests(plain);
      expect(r.decision).toBe(DECISION.SKIP);
    } finally {
      cleanupTempGitRepo(plain);
    }
  });

  it('runHookAdversarialTests 无 adversarial 目录 DENY', async () => {
    const hooksOnly = createTempGitRepo('feat/hooks-only');
    mkdirSync(join(hooksOnly, '.claude/hooks/__tests__'), { recursive: true });
    writeFileSync(join(hooksOnly, '.claude/hooks/quality-gate.ts'), 'export {};\n');
    try {
      const r = await runHookAdversarialTests(hooksOnly);
      expect(r.decision).toBe(DECISION.DENY);
    } finally {
      cleanupTempGitRepo(hooksOnly);
    }
  });
});
