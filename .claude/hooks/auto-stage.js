#!/usr/bin/env node
/**
 * Auto Stage - PostToolUse Hook for Edit|Write
 * Automatically stages files after Claude Code modifies them.
 * Logs to: ~/.claude/hooks-logs/
 *
 * Benefits:
 *   - `git status` shows exactly what Claude modified
 *   - Easy to review changes before committing
 *   - No manual staging needed
 *
 * Note: Relies on .gitignore to exclude sensitive files (.env, keys, etc.)
 *
 * Conditional staging:
 *   - Skips git add if CLAUDE_HOOK_PREVIOUS_DENIED is "true"
 *   - Sets CLAUDE_HOOK_AUTO_STAGED = 'true' after successful git add
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { execSync } from 'child_process';

const LOG_DIR = join(process.env.HOME || '', '.claude', 'hooks-logs');

function log(data) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'auto-stage', ...data }) + '\n');
  } catch {}
}

function isInGitRepo(filePath) {
  try {
    const dir = dirname(filePath);
    execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function stageFile(filePath) {
  try {
    const dir = dirname(filePath);
    execSync(`git add "${filePath}"`, { cwd: dir, stdio: 'pipe' });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, session_id, cwd } = data;

    if (!['Edit', 'Write'].includes(tool_name)) {
      return console.log('{}');
    }

    const filePath = tool_input?.file_path;
    if (!filePath) {
      log({ level: 'SKIP', reason: 'no file_path', tool: tool_name, session_id });
      return console.log('{}');
    }

    // Resolve to absolute path if relative
    const absPath = isAbsolute(filePath) ? filePath : join(cwd || process.cwd(), filePath);

    if (!isInGitRepo(absPath)) {
      log({ level: 'SKIP', reason: 'not in git repo', file: absPath, session_id });
      return console.log('{}');
    }

    // Conditional staging: skip if previous hook denied
    if (process.env.CLAUDE_HOOK_PREVIOUS_DENIED === 'true') {
      log({ level: 'SKIP', reason: 'previous hook denied', file: absPath, session_id });
      return console.log('{}');
    }

    const result = stageFile(absPath);
    if (result.success) {
      // Mark auto-staged for downstream hooks
      process.env.CLAUDE_HOOK_AUTO_STAGED = 'true';
      log({ level: 'STAGED', file: absPath, tool: tool_name, session_id });
    } else {
      log({ level: 'ERROR', file: absPath, error: result.error, session_id });
    }

    console.log('{}');
  } catch (e) {
    log({ level: 'ERROR', error: e.message });
    console.log('{}');
  }
}

main();

export { isInGitRepo, stageFile, log };
