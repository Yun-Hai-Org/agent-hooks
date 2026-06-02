// 测试基础设施 - 输入构造器、输出断言器、Mock CLI

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';

export function createHookInput(tool, toolInput = {}) {
  return {
    tool_name: tool,
    tool_input: toolInput,
    session_id: 'test-session-001',
    cwd: process.cwd(),
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
  return Buffer.from([0xFF, 0xFE, 0x00, 0x01]);
}

export function expectDeny(output) {
  if (!output) return false;
  const parsed = typeof output === 'string' ? JSON.parse(output) : output;
  return parsed?.hookSpecificOutput?.permissionDecision === 'deny';
}

export function expectAllow(output) {
  if (!output) return true;
  if (typeof output === 'string' && output.trim() === '{}') return true;
  const parsed = typeof output === 'string' ? JSON.parse(output) : output;
  return !parsed?.hookSpecificOutput || parsed.hookSpecificOutput.permissionDecision !== 'deny';
}

const FIXTURE_DIR = join(dirname(new URL(import.meta.url).pathname), 'fixtures');

export function createTempGitRepo(branch = 'feat/test') {
  const repoName = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const repoPath = join(FIXTURE_DIR, repoName);
  mkdirSync(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath });
  execSync('git config user.email "test@test.com"', { cwd: repoPath });
  execSync('git config user.name "Test"', { cwd: repoPath });
  writeFileSync(join(repoPath, 'README.md'), '# Test');
  execSync('git add .', { cwd: repoPath });
  execSync('git commit -m "init"', { cwd: repoPath });
  if (branch !== 'master' && branch !== 'main') {
    execSync(`git checkout -b ${branch}`, { cwd: repoPath });
  }
  return repoPath;
}

export function cleanupTempGitRepo(repoPath) {
  try { rmSync(repoPath, { recursive: true, force: true }); } catch {}
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
