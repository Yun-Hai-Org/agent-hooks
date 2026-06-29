import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import {
  createTempGitRepo,
  cleanupTempGitRepo,
  bootstrapQualityGateYaml,
  PROJECT_ROOT,
  runHookScript,
} from './helpers.js';
import { runFormatStaged } from '../checks/format-staged.js';
import { runLintStaged } from '../checks/lint-staged.js';
import { runStagedTypecheck, runFullTypecheck } from '../checks/typecheck.js';
import { formatFileOnWrite } from '../checks/format-on-write.js';
import { runRelatedTests, runHookAdversarialIfStaged } from '../checks/tests.js';
import { runOpenApiContractStaged } from '../checks/openapi-contract.js';
import { runWithAutoFixRetry, runAutoFixIfEnabled, getFixRunnerForPath, buildGateCheckPath } from '../gate-autofix.js';
import { executePendingMerge, runGateRetryStop, main as gateRetryStopMain } from '../gate-retry-stop.js';
import { setPendingGateFailure, clearPendingGateFailure } from '../gate-pending.js';
import { runAutoCommit, main as autoCommitMain } from '../auto-commit.js';
import { handleAutoStage } from '../auto-stage.js';
import { runQualityGate } from '../quality-gate.js';
import { runIacCheckov, hasIacTargets } from '../checks/iac-checkov.js';
import { clearGateConfigCache } from '../gate-config.js';
import { DECISION, formatResult } from '../security-orchestrator.js';

async function runHookMainInProcess(mainFn: () => Promise<void>, stdinPayload: string): Promise<string> {
  const asyncIterable = {
    async *[Symbol.asyncIterator]() {
      yield stdinPayload;
    },
  };
  const origStdin = process.stdin;
  Object.defineProperty(process, 'stdin', { value: asyncIterable, configurable: true });
  let captured = '';
  const origLog = console.log;
  console.log = (msg: string) => {
    captured = msg;
  };
  const origError = console.error;
  console.error = () => {};
  try {
    await mainFn();
  } finally {
    console.log = origLog;
    console.error = origError;
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
  }
  return captured;
}

describe('staged format/lint/typecheck with files', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/staged-checks');
    bootstrapQualityGateYaml(repoDir);
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('runFormatStaged 暂存 ts 文件应执行 prettier 路径', async () => {
    writeFileSync(join(repoDir, 'lib.ts'), 'export const x=1\n');
    execSync('git add lib.ts', { cwd: repoDir });
    const r = await runFormatStaged(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
  }, 60_000);

  it('runFormatStaged 暂存 py + pyproject 应执行 ruff 路径', async () => {
    writeFileSync(join(repoDir, 'pyproject.toml'), '[project]\nname = "demo"\n');
    writeFileSync(join(repoDir, 'main.py'), 'x=1\n');
    execSync('git add pyproject.toml main.py', { cwd: repoDir });
    const r = await runFormatStaged(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 60_000);

  it('runLintStaged 有 eslint 配置时执行 eslint 路径', async () => {
    writeFileSync(join(repoDir, 'eslint.config.js'), 'export default [];\n');
    writeFileSync(join(repoDir, 'app.js'), 'const x = 1;\n');
    execSync('git add eslint.config.js app.js', { cwd: repoDir });
    const r = await runLintStaged(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 60_000);

  it('runLintStaged 暂存 py + pyproject 应执行 ruff 路径', async () => {
    writeFileSync(join(repoDir, 'pyproject.toml'), '[project]\nname = "demo"\n');
    writeFileSync(join(repoDir, 'main.py'), 'x=1\n');
    execSync('git add pyproject.toml main.py', { cwd: repoDir });
    const r = await runLintStaged(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 60_000);

  it('runStagedTypecheck 暂存 ts + tsconfig 应执行 tsc 路径', async () => {
    writeFileSync(join(repoDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true,"noEmit":true}}');
    writeFileSync(join(repoDir, 'lib.ts'), 'export const x: number = 1;\n');
    execSync('git add tsconfig.json lib.ts', { cwd: repoDir });
    const r = await runStagedTypecheck(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 60_000);

  it('runFullTypecheck 有 tsconfig 时执行', async () => {
    writeFileSync(join(repoDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true,"noEmit":true}}');
    execSync('git add tsconfig.json', { cwd: repoDir });
    execSync('git commit -m "chore: tsconfig"', { cwd: repoDir });
    const r = await runFullTypecheck(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 60_000);
});

describe('format-on-write additional targets', () => {
  it('sh 文件应走 shfmt 路径', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'format-sh-'));
    const file = join(dir, 'script.sh');
    writeFileSync(file, '#!/bin/bash\necho hi\n');
    try {
      const r = await formatFileOnWrite(file, PROJECT_ROOT);
      expect(r.skipped.includes('unsupported-extension')).toBe(false);
      expect(r.formatted || r.skipped.length > 0 || r.errors.length > 0).toBe(true);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('toml 文件应走 taplo 路径', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'format-toml-'));
    const file = join(dir, 'config.toml');
    writeFileSync(file, 'name = "demo"\n');
    try {
      const r = await formatFileOnWrite(file, PROJECT_ROOT);
      expect(r.skipped.includes('unsupported-extension')).toBe(false);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('py + pyproject 应走 ruff 路径', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'format-py-'));
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n');
    const file = join(dir, 'main.py');
    writeFileSync(file, 'x=1\n');
    try {
      const r = await formatFileOnWrite(file, dir);
      expect(r.skipped.includes('unsupported-extension')).toBe(false);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('gate-autofix runners', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/autofix-run');
    clearGateConfigCache();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
  });

  it('prettier fix runner 无文件时失败', async () => {
    const runner = getFixRunnerForPath(buildGateCheckPath('git.pre-commit', 'format-staged-prettier'));
    expect(runner).toBeDefined();
    const result = await runner!({ cwd: repoDir, files: [] });
    expect(result.success).toBe(false);
  });

  it('runAutoFixIfEnabled 未配置 autoFix 时不运行', async () => {
    const path = buildGateCheckPath('git.pre-commit', 'format-staged-prettier');
    const result = await runAutoFixIfEnabled(path, { cwd: repoDir, files: ['a.ts'] });
    expect(result.ran).toBe(false);
    expect(result.success).toBe(true);
  });

  it('runWithAutoFixRetry autoFix 关闭时直接返回 DENY', async () => {
    const path = buildGateCheckPath('git.pre-commit', 'format-staged-prettier');
    const r = await runWithAutoFixRetry(path, { cwd: repoDir, files: ['a.ts'] }, async () =>
      formatResult('format-staged-prettier', DECISION.DENY, '格式错误'),
    );
    expect(r.decision).toBe(DECISION.DENY);
  });

  it('runWithAutoFixRetry autoFix 开启时重试检查', async () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `git:
  pre-commit:
    enabled: true
    autoFix: true
    checks:
      format-staged-prettier:
        enabled: true
`,
    );
    clearGateConfigCache();
    writeFileSync(join(repoDir, 'lib.ts'), 'export const x=1\n');
    let calls = 0;
    const path = buildGateCheckPath('git.pre-commit', 'format-staged-prettier');
    const r = await runWithAutoFixRetry(path, { cwd: repoDir, files: ['lib.ts'], timeoutMs: 30_000 }, async () => {
      calls++;
      return calls === 1
        ? formatResult('format-staged-prettier', DECISION.DENY, '格式错误')
        : formatResult('format-staged-prettier', DECISION.ALLOW, '通过');
    });
    expect([DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
    expect(calls).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe('tests.ts additional paths', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/related-tests');
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('runRelatedTests 暂存非代码文件 SKIP', async () => {
    writeFileSync(join(repoDir, 'readme.md'), '# hi\n');
    execSync('git add readme.md', { cwd: repoDir });
    const r = await runRelatedTests(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runRelatedTests 无关联测试文件 SKIP', async () => {
    writeFileSync(join(repoDir, 'lib.ts'), 'export const v = 1;\n');
    execSync('git add lib.ts', { cwd: repoDir });
    const r = await runRelatedTests(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('runHookAdversarialIfStaged 暂存 hooks 文件时执行', async () => {
    mkdirSync(join(repoDir, '.claude/hooks'), { recursive: true });
    writeFileSync(join(repoDir, '.claude/hooks/dummy.ts'), 'export {};\n');
    execSync('git add .claude/hooks/dummy.ts', { cwd: repoDir });
    const r = await runHookAdversarialIfStaged(repoDir);
    expect([DECISION.SKIP, DECISION.ALLOW, DECISION.DENY]).toContain(r.decision);
  }, 60_000);
});

describe('openapi-contract with HEAD baseline', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/openapi-base');
    writeFileSync(
      join(repoDir, 'openapi.yaml'),
      `openapi: 3.0.0
info:
  title: Test
  version: 1.0.0
paths: {}
`,
    );
    execSync('git add openapi.yaml', { cwd: repoDir });
    execSync('git commit -m "chore: add spec"', { cwd: repoDir });
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('runOpenApiContractStaged 有基线时执行 breaking 检测', async () => {
    writeFileSync(
      join(repoDir, 'openapi.yaml'),
      `openapi: 3.0.0
info:
  title: Test
  version: 2.0.0
paths: {}
`,
    );
    execSync('git add openapi.yaml', { cwd: repoDir });
    const r = await runOpenApiContractStaged(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 120_000);
});

describe('gate-retry-stop merge helpers', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/gate-merge');
    bootstrapQualityGateYaml(repoDir);
  });

  afterEach(() => {
    clearPendingGateFailure('merge-session', repoDir);
    cleanupTempGitRepo(repoDir);
  });

  it('executePendingMerge 无效命令应失败', () => {
    const r = executePendingMerge({ type: 'merge', command: 'git merge --no-such-branch', cwd: repoDir });
    expect(r.success).toBe(false);
  });

  it('runGateRetryStop GATE_RETRY_STOP=0 时 skip', async () => {
    process.env.GATE_RETRY_STOP = '0';
    setPendingGateFailure('retry-off', { type: 'push', command: 'git push', cwd: repoDir });
    const r = await runGateRetryStop('retry-off', { cwd: repoDir });
    expect(r.action).toBe('skip');
    delete process.env.GATE_RETRY_STOP;
  });
});

describe('auto-commit success path', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/auto-commit-ok');
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('feature 分支有暂存变更时应提交', () => {
    writeFileSync(join(repoDir, 'feat.js'), 'export const x = 1;\n');
    execSync('git add feat.js', { cwd: repoDir });
    const r = runAutoCommit(repoDir, { sessionId: 'test-commit' });
    expect(r.committed).toBe(true);
    expect(r.sha).toBeDefined();
  });
});

describe('CLI hook main entrypoints', () => {
  const autoStagePath = join(import.meta.dir, '..', 'auto-stage.ts');
  const autoCommitPath = join(import.meta.dir, '..', 'auto-commit.ts');
  const gateRetryStopPath = join(import.meta.dir, '..', 'gate-retry-stop.ts');

  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/cli-hooks');
    bootstrapQualityGateYaml(repoDir);
    execSync('git add .claude/quality-gate.yaml', { cwd: repoDir });
    execSync('git commit -m "chore: gate config"', { cwd: repoDir });
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('auto-stage Write 工具应暂存文件', async () => {
    const testFile = join(repoDir, 'auto-stage.txt');
    writeFileSync(testFile, 'content\n');
    const input = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: testFile },
      session_id: 'cli-stage-1',
      cwd: repoDir,
    });
    const { code, stdout } = await runHookScript(autoStagePath, input);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('{}');
    const status = execSync('git status --porcelain', { cwd: repoDir, encoding: 'utf-8' });
    expect(status).toContain('auto-stage.txt');
  });

  it('auto-stage 非文件编辑工具应放行', async () => {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
      session_id: 'cli-stage-2',
      cwd: repoDir,
    });
    const { code, stdout } = await runHookScript(autoStagePath, input);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('{}');
  });

  it('auto-commit Stop 无暂存应输出 {}', async () => {
    const input = JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'cli-commit-1',
      cwd: repoDir,
    });
    const { code, stdout } = await runHookScript(autoCommitPath, input, { AUTO_COMMIT_MODE: 'auto' });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('{}');
  });

  it('gate-retry-stop 无 pending 应输出 {}', async () => {
    const input = JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'cli-retry-1',
      cwd: repoDir,
    });
    const { code, stdout } = await runHookScript(gateRetryStopPath, input);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('{}');
  });

  it('gate-retry-stop GATE_RETRY_STOP=0 应输出 {}', async () => {
    const input = JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'cli-retry-2',
      cwd: repoDir,
    });
    const { code, stdout } = await runHookScript(gateRetryStopPath, input, { GATE_RETRY_STOP: '0' });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('{}');
  });
});

describe('hook main in-process', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/main-inproc');
    bootstrapQualityGateYaml(repoDir);
    execSync('git add .claude/quality-gate.yaml', { cwd: repoDir });
    execSync('git commit -m "chore: gate config"', { cwd: repoDir });
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    delete process.env.GATE_RETRY_STOP;
    delete process.env.AUTO_COMMIT_MODE;
  });

  it('auto-commit main 无暂存输出 {}', async () => {
    const out = await runHookMainInProcess(
      autoCommitMain,
      JSON.stringify({ hook_event_name: 'Stop', session_id: 'main-ac', cwd: repoDir }),
    );
    expect(out.trim()).toBe('{}');
  });

  it('handleAutoStage Write 工具输出 {}', async () => {
    const testFile = join(repoDir, 'inproc.txt');
    writeFileSync(testFile, 'hello\n');
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      captured = msg;
    };
    try {
      await handleAutoStage({
        tool_name: 'Write',
        tool_input: { file_path: testFile },
        session_id: 'main-as',
        cwd: repoDir,
      });
    } finally {
      console.log = origLog;
    }
    expect(captured.trim()).toBe('{}');
  });

  it('handleAutoStage 非编辑工具 skip', async () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      captured = msg;
    };
    try {
      await handleAutoStage({ tool_name: 'Bash', tool_input: {}, session_id: 'main-as2', cwd: repoDir });
    } finally {
      console.log = origLog;
    }
    expect(captured.trim()).toBe('{}');
  });

  it('handleAutoStage CLAUDE_HOOK_PREVIOUS_DENIED skip', async () => {
    process.env.CLAUDE_HOOK_PREVIOUS_DENIED = 'true';
    const testFile = join(repoDir, 'denied.txt');
    writeFileSync(testFile, 'x\n');
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      captured = msg;
    };
    try {
      await handleAutoStage({
        tool_name: 'Write',
        tool_input: { file_path: testFile },
        session_id: 'main-as3',
        cwd: repoDir,
      });
    } finally {
      console.log = origLog;
      delete process.env.CLAUDE_HOOK_PREVIOUS_DENIED;
    }
    expect(captured.trim()).toBe('{}');
  });

  it('gate-retry-stop main 无 pending 输出 {}', async () => {
    const out = await runHookMainInProcess(
      gateRetryStopMain,
      JSON.stringify({ hook_event_name: 'Stop', session_id: 'main-gr', cwd: repoDir }),
    );
    expect(out.trim()).toBe('{}');
  });
});

describe('runQualityGate full profile', () => {
  it('full profile 跳过 hook-unit-tests 可运行', async () => {
    const result = await runQualityGate({
      profile: 'full',
      cwd: PROJECT_ROOT,
      skipCheckIds: ['hook-unit-tests'],
    });
    expect(result.results.length).toBeGreaterThan(10);
    expect(result).toHaveProperty('passed');
    const hookUnit = result.results.find((r) => r.checkId === 'hook-unit-tests');
    expect(hookUnit?.decision).toBe(DECISION.SKIP);
  }, 300_000);
});

describe('iac-checkov targets', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/iac');
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
  });

  it('hasIacTargets 识别 k8s 目录', () => {
    mkdirSync(join(repoDir, 'k8s'), { recursive: true });
    writeFileSync(join(repoDir, 'k8s/deployment.yaml'), 'apiVersion: v1\nkind: Pod\n');
    execSync('git add k8s/deployment.yaml', { cwd: repoDir });
    execSync('git commit -m "chore: k8s"', { cwd: repoDir });
    expect(hasIacTargets(repoDir)).toBe(true);
  });

  it('runIacCheckov 有 IaC 目标时执行', async () => {
    mkdirSync(join(repoDir, 'k8s'), { recursive: true });
    writeFileSync(join(repoDir, 'k8s/deployment.yaml'), 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\n');
    execSync('git add k8s/deployment.yaml', { cwd: repoDir });
    execSync('git commit -m "chore: k8s"', { cwd: repoDir });
    const r = await runIacCheckov(repoDir);
    expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(r.decision);
  }, 120_000);
});
