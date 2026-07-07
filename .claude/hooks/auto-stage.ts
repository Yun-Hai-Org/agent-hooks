#!/usr/bin/env bun
/**
 * Auto Stage - PostToolUse / afterFileEdit Hook
 * Agent 修改文件后自动 git add
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { execSync } from 'child_process';
import { LOG_DIR } from './security-orchestrator.js';
import { readFileEditInput, isFileEditTool } from './hook-adapter.js';
import { isGateNodeEnabled } from './gate-config.js';

function log(data: Record<string, unknown>) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'auto-stage', ...data }) + '\n');
  } catch {}
}

function isInGitRepo(filePath: string) {
  try {
    const dir = dirname(filePath);
    execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function stageFile(filePath: string) {
  try {
    const dir = dirname(filePath);
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- 命令参数为内部构造，cwd 为受信文件目录
    execSync(`git add "${filePath}"`, { cwd: dir, stdio: 'pipe' });
    return { success: true };
  } catch (/** @type {unknown} */ e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  try {
    const data = await readFileEditInput();
    handleAutoStage(data);
  } catch (/** @type {unknown} */ e) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    writeEmptyOutput();
  }
}

function writeEmptyOutput(): void {
  process.stdout.write('{}\n');
}

export function handleAutoStage(data: {
  tool_name?: string;
  tool_input?: { file_path?: string };
  session_id?: string;
  cwd?: string;
}): void {
  const { tool_name, tool_input, session_id, cwd = process.cwd() } = data;

  if (!isGateNodeEnabled('ide.auto-stage', cwd)) {
    log({ level: 'SKIP', reason: 'gate disabled', session_id });
    writeEmptyOutput();
    return;
  }

  if (!isFileEditTool(tool_name)) {
    log({ level: 'SKIP', reason: `unsupported tool: ${tool_name ?? '(empty)'}`, session_id });
    writeEmptyOutput();
    return;
  }

  const filePath = tool_input?.file_path;
  if (!filePath || typeof filePath !== 'string') {
    log({ level: 'SKIP', reason: 'no file_path', tool: tool_name, session_id });
    writeEmptyOutput();
    return;
  }

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信工作目录，filePath 来自 hook 输入
  const absPath = isAbsolute(filePath) ? filePath : join(cwd, filePath);

  if (!isInGitRepo(absPath)) {
    log({ level: 'SKIP', reason: 'not in git repo', file: absPath, session_id });
    writeEmptyOutput();
    return;
  }

  if (process.env['CLAUDE_HOOK_PREVIOUS_DENIED'] === 'true') {
    log({ level: 'SKIP', reason: 'previous hook denied', file: absPath, session_id });
    writeEmptyOutput();
    return;
  }

  const result = stageFile(absPath);
  if (result.success) {
    process.env['CLAUDE_HOOK_AUTO_STAGED'] = 'true';
    log({ level: 'STAGED', file: absPath, tool: tool_name, session_id });
  } else {
    log({ level: 'ERROR', file: absPath, error: result.error, session_id });
  }

  writeEmptyOutput();
}

if (import.meta.main) {
  void main();
}

export { isInGitRepo, stageFile, log };
