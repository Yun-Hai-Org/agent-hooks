#!/usr/bin/env bun
/**
 * Worktree Gate - PreToolUse Write|Shell
 * Deny file writes on main checkout; allow inside git worktrees on feat/* branches.
 */

import { existsSync, appendFileSync, mkdirSync, realpathSync } from 'fs';
import { join, resolve, isAbsolute, basename } from 'path';
import { LOG_DIR, readStdin, isGitRepo, execCommand } from './security-orchestrator.js';
import { repoRelativePathFromAbs } from './checks/scan-scope.js';
import {
  normalizeInput,
  normalizeFileEditInput,
  formatDenyOutput,
  formatAllowOutput,
  isShellTool,
  getPlatform,
} from './hook-adapter.js';
import { isGateNodeEnabled } from './gate-config.js';
import {
  getCurrentBranch,
  isInsideWorktree,
  isSafeCommand,
  isGitBootstrapCommand,
  isFileWriteCommand,
  getWritePatternName,
  ALLOWED_PATHS_ON_MAIN,
  isAllowedPathOnMain,
} from './branch-gate.js';
import { notifyGateBlockedAsync } from './gate-blocked-notify.js';

const HOOK_NAME = 'worktree-gate';
const FEAT_BRANCH_PREFIX = 'feat/';
const WORKTREE_ADD_PATTERN = /\bgit\s+worktree\s+add\b/;
const WORKTREE_LIST_PATTERN = /\bgit\s+worktree\s+(list|remove|prune)\b/;

function log(data: Record<string, unknown>) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: HOOK_NAME, ...data }) + '\n');
  } catch {}
}

function isWorktreeBootstrapCommand(command: string): boolean {
  if (!command) return false;
  return WORKTREE_ADD_PATTERN.test(command) || WORKTREE_LIST_PATTERN.test(command) || isGitBootstrapCommand(command);
}

function isFeatBranch(branch: string | null): boolean {
  return Boolean(branch && (branch.startsWith(FEAT_BRANCH_PREFIX) || branch.includes('-task-')));
}

function deny(reason: string) {
  return formatDenyOutput('deny', reason);
}

function emit(out: string) {
  process.stdout.write(`${out}\n`);
}

function allow() {
  return formatAllowOutput();
}

async function readGateInput() {
  const raw = await readStdin();
  if (getPlatform() === 'cursor' && typeof raw['file_path'] === 'string' && !raw['tool_name'] && !raw['toolName']) {
    const data = normalizeFileEditInput(raw);
    return { ...data, tool_name: 'Write' };
  }
  const data = normalizeInput(raw);
  let tool_name = data.tool_name;
  if (/^write$/i.test(tool_name)) tool_name = 'Write';
  if (isShellTool(tool_name)) tool_name = 'Shell';
  return { ...data, tool_name };
}

async function main() {
  try {
    const data = await readGateInput();
    const { tool_name, tool_input, session_id, cwd } = data;
    const workingDir = cwd || process.cwd();

    if (!isGateNodeEnabled('ide.worktree-gate', workingDir)) {
      emit(allow());
      return;
    }

    if (!['Write', 'Edit', 'Shell'].includes(tool_name)) {
      emit(allow());
      return;
    }

    if (!isGitRepo(workingDir)) {
      emit(allow());
      return;
    }

    if (tool_name === 'Shell') {
      const command = tool_input.command ?? '';
      if (isWorktreeBootstrapCommand(command) || isSafeCommand(command)) {
        emit(allow());
        return;
      }
      if (!isFileWriteCommand(command)) {
        emit(allow());
        return;
      }
    }

    if (tool_name === 'Write' || tool_name === 'Edit' || tool_name === 'StrReplace') {
      const rawFilePath = tool_input.file_path ?? '';
      if (rawFilePath) {
        let absPath = isAbsolute(rawFilePath) ? rawFilePath : resolve(workingDir, rawFilePath);
        try { absPath = realpathSync(absPath); } catch { absPath = join(realpathSync(resolve(absPath, '..')), basename(absPath)); }
        const rootResult = execCommand('git rev-parse --show-toplevel', { cwd: workingDir });
        if (rootResult.success && rootResult.stdout.trim()) {
          const rel = repoRelativePathFromAbs(absPath, rootResult.stdout.trim());
          if (rel === null) {
            log({ level: 'INFO', reason: 'write outside repo allowed', file: absPath, tool: tool_name, session_id });
            emit(allow());
            return;
          }
        }
      }
    }

    if (tool_name === 'Shell') {
      const command = tool_input.command ?? '';
      if (ALLOWED_PATHS_ON_MAIN.some((p) => command.includes(p))) {
        log({ level: 'INFO', reason: 'allowed planning path in shell command', command: command.slice(0, 200), session_id });
        emit(allow());
        return;
      }
    } else {
      const filePath = tool_input.file_path ?? '';
      if (isAllowedPathOnMain(filePath)) {
        log({ level: 'INFO', reason: 'allowed planning path', file: filePath, tool: tool_name, session_id });
        emit(allow());
        return;
      }
    }

    const insideWorktree = isInsideWorktree(workingDir);
    const branch = getCurrentBranch(workingDir);

    if (insideWorktree && isFeatBranch(branch)) {
      emit(allow());
      return;
    }

    const detail = tool_name === 'Shell' ? (tool_input.command ?? '').slice(0, 120) : (tool_input.file_path ?? '');
    log({
      level: 'BLOCKED',
      reason: 'write outside worktree or non-feat branch',
      tool: tool_name,
      branch,
      insideWorktree,
      detail,
      session_id,
      cwd: workingDir,
    });

    const patternName = tool_name === 'Shell' ? getWritePatternName(tool_input.command ?? '') : 'Write';
    const msg = insideWorktree
      ? `🔒 [worktree-gate] 当前 worktree 分支 ${branch ?? 'unknown'} 非 feat/*。请使用 feat/<name> 分支 worktree。`
      : `🔒 [worktree-gate] 禁止在主 checkout 修改代码${patternName ? ` (${patternName})` : ''}。请先 git worktree add .worktrees/<branch> -b feat/<name> 并在该目录工作。`;

    notifyGateBlockedAsync({
      hook: HOOK_NAME,
      reason: msg,
      cwd: workingDir,
      ...(session_id !== undefined ? { session_id } : {}),
    });
    emit(deny(msg));
  } catch (e: unknown) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    emit(allow());
  }
}

if (import.meta.main) {
  void main();
}

export { HOOK_NAME, isWorktreeBootstrapCommand, isFeatBranch, main };
