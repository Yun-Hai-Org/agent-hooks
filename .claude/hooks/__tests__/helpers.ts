// 测试基础设施 - 输入构造器、输出断言器、Mock CLI

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { clearGateConfigCache } from '../gate-config.js';
import { getHookProcessEnv } from '../security-orchestrator.js';
import { resolveBunExecutable } from '../checks/tools.js';

/** 仓库根目录（tests 从 .claude/hooks 运行时 cwd 不是根） */
export const PROJECT_ROOT = join(import.meta.dir, '..', '..', '..');

export function createHookInput(tool, toolInput = {}) {
  return {
    tool_name: tool,
    tool_input: toolInput,
    session_id: 'test-session-001',
    cwd: PROJECT_ROOT,
    permission_mode: 'default',
  };
}

export function createEmptyInput() {
  return '{}';
}

export function createTruncatedJsonInput() {
  return '{"tool_name": "Write", "tool_input';
}

export function createNonUtf8Input() {
  return Buffer.from([0xff, 0xfe, 0x00, 0x01]);
}

export function expectDeny(output) {
  if (!output) return false;
  const parsed = typeof output === 'string' ? JSON.parse(output) : output;
  return parsed?.hookSpecificOutput?.permissionDecision === 'deny' || parsed?.permission === 'deny';
}

export function expectAllow(output) {
  if (!output) return true;
  if (typeof output === 'string' && output.trim() === '{}') return true;
  const parsed = typeof output === 'string' ? JSON.parse(output) : output;
  return !parsed?.hookSpecificOutput || parsed.hookSpecificOutput.permissionDecision !== 'deny';
}

const FIXTURE_DIR = join(tmpdir(), `hook-tests-${process.pid}`);

export function useEmptyGlobalQualityGateConfig(): void {
  process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
  clearGateConfigCache();
}

export function restoreGlobalQualityGateConfig(): void {
  process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] = join(import.meta.dir, 'empty-global-quality-gate.yaml');
  clearGateConfigCache();
}

export function disableGlobalGitHooks(cwd: string) {
  execSync('git config --local core.hooksPath .git/hooks', { cwd, stdio: 'pipe' });
}

/** 为测试仓库写入 quality-gate 白名单（从项目 example 复制） */
export function bootstrapQualityGateYaml(repoDir: string): void {
  const src = join(PROJECT_ROOT, '.claude', 'quality-gate.yaml');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- repoDir 为受信临时测试仓库根
  const destDir = join(repoDir, '.claude');
  mkdirSync(destDir, { recursive: true });
  const content = existsSync(src)
    ? readFileSync(src, 'utf-8')
    : 'ide:\n  branch-gate:\n    enabled: true\n  block-dangerous-commands:\n    enabled: true\n';
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- repoDir 为受信临时测试仓库根
  writeFileSync(join(destDir, 'quality-gate.yaml'), content, 'utf-8');
  clearGateConfigCache();
}

export function createTempGitRepo(branch = 'feat/test') {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const repoName = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const repoPath = join(FIXTURE_DIR, repoName);
  mkdirSync(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- 测试夹具初始化受信临时仓库
  execSync('git config user.email "test@test.com"', { cwd: repoPath });
  execSync('git config user.name "Test"', { cwd: repoPath });
  disableGlobalGitHooks(repoPath);
  writeFileSync(join(repoPath, 'README.md'), '# Test');
  execSync('git add .', { cwd: repoPath });
  execSync('git commit -m "chore: init"', { cwd: repoPath });
  if (branch !== 'master' && branch !== 'main') {
    execSync(`git checkout -b ${branch}`, { cwd: repoPath }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- branch 为测试构造的分支名
  }
  return repoPath;
}

export function cleanupTempGitRepo(repoPath) {
  try {
    rmSync(repoPath, { recursive: true, force: true });
  } catch {}
}

export function writeFile(repoPath, relativePath, content) {
  const fullPath = join(repoPath, relativePath); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- repoPath 为受信临时测试仓库根，relativePath 由测试构造
  const dir = dirname(fullPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
  return fullPath;
}

export function expectPerformance(durationMs, maxMs) {
  return durationMs <= maxMs;
}

/** 统一测试 hook 环境（Claude 平台 + 可选覆盖） */
export function getTestHookEnv(envOverrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return getHookProcessEnv({ HOOK_PLATFORM: 'claude', ...envOverrides });
}

/** 运行 hook 脚本并返回 stdout/stderr/exit code */
export function runHookScript(
  scriptPath: string,
  input = '{}',
  envOverrides: Record<string, string> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBunExecutable(), [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getTestHookEnv(envOverrides),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
    child.stdin.write(input);
    child.stdin.end();
  });
}
