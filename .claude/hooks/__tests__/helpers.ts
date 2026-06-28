// 测试基础设施 - 输入构造器、输出断言器、Mock CLI

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { clearGateConfigCache } from '../gate-config.js';

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

export function disableGlobalGitHooks(cwd: string) {
  execSync('git config --local core.hooksPath .git/hooks', { cwd, stdio: 'pipe' });
}

/** 为测试仓库写入 quality-gate 白名单（从项目 example 复制） */
export function bootstrapQualityGateYaml(repoDir: string): void {
  const src = join(PROJECT_ROOT, '.claude', 'quality-gate.yaml');
  const destDir = join(repoDir, '.claude');
  mkdirSync(destDir, { recursive: true });
  const content = existsSync(src)
    ? readFileSync(src, 'utf-8')
    : 'ide:\n  branch-gate:\n    enabled: true\n  block-dangerous-commands:\n    enabled: true\n';
  writeFileSync(join(destDir, 'quality-gate.yaml'), content, 'utf-8');
  clearGateConfigCache();
}

export function createTempGitRepo(branch = 'feat/test') {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const repoName = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const repoPath = join(FIXTURE_DIR, repoName);
  mkdirSync(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath });
  execSync('git config user.email "test@test.com"', { cwd: repoPath });
  execSync('git config user.name "Test"', { cwd: repoPath });
  disableGlobalGitHooks(repoPath);
  writeFileSync(join(repoPath, 'README.md'), '# Test');
  execSync('git add .', { cwd: repoPath });
  execSync('git commit -m "chore: init"', { cwd: repoPath });
  if (branch !== 'master' && branch !== 'main') {
    execSync(`git checkout -b ${branch}`, { cwd: repoPath });
  }
  return repoPath;
}

export function cleanupTempGitRepo(repoPath) {
  try {
    rmSync(repoPath, { recursive: true, force: true });
  } catch {}
}

export function writeFile(repoPath, relativePath, content) {
  const fullPath = join(repoPath, relativePath);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
  return fullPath;
}

export function expectPerformance(durationMs, maxMs) {
  return durationMs <= maxMs;
}
