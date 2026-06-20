#!/usr/bin/env bun
/**
 * Branch Gate - PreToolUse Hook for Write|Edit|Bash
 * 阻止直接向 main/master 分支写入代码
 */

import { execSync } from 'child_process';
import { existsSync, statSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR } from './security-orchestrator.js';
import {
  normalizeInput,
  normalizeFileEditInput,
  formatDenyOutput,
  formatAllowOutput,
  isShellTool,
  getPlatform,
} from './hook-adapter.js';
import { readStdin } from './security-orchestrator.js';
import { notifySecurityEventAsync } from './notify-security-event.js';

const MAIN_BRANCHES = ['main', 'master'];
const ALLOWED_PATHS_ON_MAIN = ['_bmad-output/'];
const SAFE_COMMAND_PATTERNS = [/^\s*git\s+(checkout|branch|stash|log|status|show|diff)\b/];
const FILE_WRITE_PATTERNS = [
  { pattern: />\s*\S+/, name: '重定向写入 (>)' },
  { pattern: />>\s*\S+/, name: '追加写入 (>>)' },
  { pattern: /\btee\b/, name: 'tee 命令' },
  { pattern: /\bsed\s+-i\b/, name: 'sed 原地编辑' },
  { pattern: /\bcp\s+/, name: 'cp 复制' },
  { pattern: /\bmv\s+/, name: 'mv 移动' },
  { pattern: /\becho\b.*>/, name: 'echo 重定向' },
  { pattern: /\bdd\s+/, name: 'dd 命令' },
  { pattern: /\binstall\s+/, name: 'install 命令' },
  { pattern: /\bcat\s+.*>/, name: 'cat 重定向' },
  { pattern: /\bprintf\b.*>/, name: 'printf 重定向' },
];

/** @param {Record<string, unknown>} data */
function log(data) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'branch-gate', ...data }) + '\n');
  } catch {}
}

/** @param {string} cwd */
function getCurrentBranch(cwd) {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/** @param {string} cwd */
function isInsideWorktree(cwd) {
  try {
    const gitPath = join(cwd, '.git');
    if (!existsSync(gitPath)) return false;
    return statSync(gitPath).isFile();
  } catch {
    return false;
  }
}

/** @param {string} command */
function isSafeCommand(command) {
  return SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

/** @param {string} filePath */
function isAllowedPathOnMain(filePath) {
  return ALLOWED_PATHS_ON_MAIN.some((allowed) => filePath.startsWith(allowed));
}

/** @param {string} command */
function isFileWriteCommand(command) {
  if (!command) return false;
  const commandWithoutDevNull = command.replace(/\d*\s*>\s*\/dev\/null/g, '');
  if (!/>(?!&)|tee|sed\s+-i|\bcp\b|\bmv\b|\bdd\b|\binstall\b/.test(commandWithoutDevNull)) {
    return false;
  }
  return FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(commandWithoutDevNull));
}

/** @param {string} command */
function getWritePatternName(command) {
  if (!command) return null;
  const commandWithoutDevNull = command.replace(/\d*\s*>\s*\/dev\/null/g, '');
  for (const { pattern, name } of FILE_WRITE_PATTERNS) {
    if (pattern.test(commandWithoutDevNull)) return name;
  }
  return null;
}

/** @param {string} toolName */
function normalizeToolName(toolName) {
  if (isShellTool(toolName)) return 'Bash';
  if (/^write$/i.test(toolName)) return 'Write';
  if (/^edit$/i.test(toolName)) return 'Edit';
  return toolName;
}

async function readBranchGateInput() {
  const raw = await readStdin();
  if (getPlatform() === 'cursor' && typeof raw.file_path === 'string' && !raw.tool_name && !raw.toolName) {
    const data = normalizeFileEditInput(raw);
    return { ...data, tool_name: normalizeToolName(data.tool_name) };
  }
  const data = normalizeInput(raw);
  return { ...data, tool_name: normalizeToolName(data.tool_name) };
}

/** @param {string} reason @param {string} [session_id] */
function deny(reason, session_id) {
  notifySecurityEventAsync({
    hook: 'branch-gate',
    severity: 'high',
    reason,
    session_id,
  });
  return formatDenyOutput('deny', reason);
}

function allow() {
  return formatAllowOutput();
}

async function main() {
  try {
    const data = await readBranchGateInput();
    const { tool_name, tool_input, session_id, cwd } = data;

    if (!['Write', 'Edit', 'Bash'].includes(tool_name)) {
      return console.log(allow());
    }

    const workingDir = cwd || process.cwd();
    const branch = getCurrentBranch(workingDir);
    if (!branch) {
      log({ level: 'WARN', reason: 'cannot determine branch', tool: tool_name, session_id });
      return console.log(allow());
    }

    if (!MAIN_BRANCHES.includes(branch)) {
      return console.log(allow());
    }

    if (tool_name === 'Bash') {
      const command = tool_input?.command || '';

      if (/\bgit\s+worktree\s+add\b/.test(command) && /\b(main|master)\b/.test(command)) {
        log({ level: 'BLOCKED', reason: 'worktree add on main/master', command: command.slice(0, 200), session_id });
        return console.log(
          deny(
            `🔒 [branch-gate] 禁止在 main/master 上创建 worktree 进行开发。请使用 feature 分支 worktree。`,
            session_id,
          ),
        );
      }

      if (isSafeCommand(command)) {
        return console.log(allow());
      }

      if (!isFileWriteCommand(command)) {
        return console.log(allow());
      }

      const patternName = getWritePatternName(command);
      if (ALLOWED_PATHS_ON_MAIN.some((p) => command.includes(p))) {
        log({
          level: 'INFO',
          reason: 'allowed path in bash command on main',
          command: command.slice(0, 200),
          tool: tool_name,
          session_id,
        });
        return console.log(allow());
      }

      log({
        level: 'BLOCKED',
        tool: tool_name,
        branch,
        command: command.slice(0, 200),
        pattern: patternName,
        session_id,
        cwd: workingDir,
      });
      return console.log(
        deny(
          `🔒 [branch-gate] 禁止在 ${branch} 分支执行文件写入操作 (${patternName})。请切换到功能分支后再试。`,
          session_id,
        ),
      );
    }

    const filePath = tool_input?.file_path || '';
    if (isAllowedPathOnMain(filePath)) {
      log({ level: 'INFO', reason: 'allowed path on main', file: filePath, tool: tool_name, session_id });
      return console.log(allow());
    }

    log({
      level: 'BLOCKED',
      tool: tool_name,
      branch,
      file: filePath,
      session_id,
      cwd: workingDir,
    });
    return console.log(deny(`🔒 [branch-gate] 禁止在 ${branch} 分支写入文件。请切换到功能分支后再试。`, session_id));
  } catch (/** @type {unknown} */ e) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    console.log(allow());
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1]);
if (isDirectRun) {
  main();
}

export {
  MAIN_BRANCHES,
  ALLOWED_PATHS_ON_MAIN,
  SAFE_COMMAND_PATTERNS,
  FILE_WRITE_PATTERNS,
  log,
  getCurrentBranch,
  isInsideWorktree,
  isSafeCommand,
  isAllowedPathOnMain,
  isFileWriteCommand,
  getWritePatternName,
  allow,
  deny,
  main,
  normalizeToolName,
};
