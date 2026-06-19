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

/** @param {Record<string, unknown>} data */
function log(data) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'auto-stage', ...data }) + '\n');
  } catch {}
}

/** @param {string} filePath */
function isInGitRepo(filePath) {
  try {
    const dir = dirname(filePath);
    execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} filePath */
function stageFile(filePath) {
  try {
    const dir = dirname(filePath);
    execSync(`git add "${filePath}"`, { cwd: dir, stdio: 'pipe' });
    return { success: true };
  } catch (/** @type {unknown} */ e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  try {
    const data = await readFileEditInput();
    const { tool_name, tool_input, session_id, cwd } = data;

    if (!isFileEditTool(tool_name)) {
      log({ level: 'SKIP', reason: `unsupported tool: ${tool_name || '(empty)'}`, session_id });
      return console.log('{}');
    }

    const filePath = tool_input?.file_path;
    if (!filePath || typeof filePath !== 'string') {
      log({ level: 'SKIP', reason: 'no file_path', tool: tool_name, session_id });
      return console.log('{}');
    }

    const absPath = isAbsolute(filePath) ? filePath : join(cwd || process.cwd(), filePath);

    if (!isInGitRepo(absPath)) {
      log({ level: 'SKIP', reason: 'not in git repo', file: absPath, session_id });
      return console.log('{}');
    }

    if (process.env.CLAUDE_HOOK_PREVIOUS_DENIED === 'true') {
      log({ level: 'SKIP', reason: 'previous hook denied', file: absPath, session_id });
      return console.log('{}');
    }

    const result = stageFile(absPath);
    if (result.success) {
      process.env.CLAUDE_HOOK_AUTO_STAGED = 'true';
      log({ level: 'STAGED', file: absPath, tool: tool_name, session_id });
    } else {
      log({ level: 'ERROR', file: absPath, error: result.error, session_id });
    }

    console.log('{}');
  } catch (/** @type {unknown} */ e) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    console.log('{}');
  }
}

const isDirectRun = import.meta.main || (process.argv[1] && import.meta.url.endsWith(process.argv[1]));
if (isDirectRun) {
  main();
}

export { isInGitRepo, stageFile, log };
