#!/usr/bin/env bun
/**
 * Branch Gate - PreToolUse Hook for Write|Edit|Bash
 * 阻止直接向 main/master 分支写入代码
 *
 * 功能：
 * 1. 检测当前 git 分支，如果是 main 或 master，拒绝写入操作
 * 2. 支持 worktree 环境检测（.git 是文件=worktree，允许）
 * 3. 对于 Bash 工具：检测文件写入型命令
 * 4. 对于 Write/Edit 工具：直接检查分支
 */

import { execSync } from 'child_process';
import { existsSync, statSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const MAIN_BRANCHES = ['main', 'master'];
const LOG_DIR = join(process.env.HOME || '', '.claude', 'hooks-logs');

// 安全命令白名单（主分支上允许执行的只读 git 命令）
const SAFE_COMMAND_PATTERNS = [/^\s*git\s+(checkout|branch|stash|log|status|show|diff)\b/];

// 文件写入型命令模式
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

/** @param {string} command */
function isFileWriteCommand(command) {
  if (!command) return false;
  // 排除 /dev/null 重定向（丢弃输出，不是写文件）
  const commandWithoutDevNull = command.replace(/\d*\s*>\s*\/dev\/null/g, '');
  // 快速检查：如果没有重定向或文件操作关键字，直接返回 false
  // 注意：排除 >&（重定向到文件描述符，如 2>&1）不是文件写入
  if (!/>(?!&)|tee|sed\s+-i|\bcp\b|\bmv\b|\bdd\b|\binstall\b/.test(commandWithoutDevNull)) {
    return false;
  }
  // 详细检查文件写入模式
  return FILE_WRITE_PATTERNS.some(({ pattern }) => pattern.test(commandWithoutDevNull));
}

/** @param {string} command */
function getWritePatternName(command) {
  if (!command) return null;
  // 排除 /dev/null 重定向（丢弃输出，不是写文件）
  const commandWithoutDevNull = command.replace(/\d*\s*>\s*\/dev\/null/g, '');
  for (const { pattern, name } of FILE_WRITE_PATTERNS) {
    if (pattern.test(commandWithoutDevNull)) return name;
  }
  return null;
}

/** @param {string} reason */
function deny(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function allow() {
  return JSON.stringify({});
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, session_id, cwd } = data;

    // 非目标工具快速退出
    if (!['Write', 'Edit', 'Bash'].includes(tool_name)) {
      return console.log(allow());
    }

    const workingDir = cwd || process.cwd();

    // 检测是否为 worktree 环境
    if (isInsideWorktree(workingDir)) {
      log({ level: 'INFO', reason: 'worktree detected, skipping branch check', tool: tool_name, session_id });
      return console.log(allow());
    }

    // 获取当前分支
    const branch = getCurrentBranch(workingDir);
    if (!branch) {
      log({ level: 'WARN', reason: 'cannot determine branch', tool: tool_name, session_id });
      return console.log(allow());
    }

    // 检查是否为主分支
    if (!MAIN_BRANCHES.includes(branch)) {
      return console.log(allow());
    }

    // 主分支上的操作 - 根据工具类型处理
    if (tool_name === 'Bash') {
      const command = tool_input?.command || '';

      // 安全命令白名单放行
      if (isSafeCommand(command)) {
        return console.log(allow());
      }

      // Fast bail-out: 非文件写入命令直接放行
      if (!isFileWriteCommand(command)) {
        return console.log(allow());
      }
      // 文件写入命令 - 拒绝
      const patternName = getWritePatternName(command);
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
        deny(`🔒 [branch-gate] 禁止在 ${branch} 分支执行文件写入操作 (${patternName})。请切换到功能分支后再试。`),
      );
    }

    // Write/Edit 工具 - 直接拒绝
    const filePath = tool_input?.file_path || '';
    log({
      level: 'BLOCKED',
      tool: tool_name,
      branch,
      file: filePath,
      session_id,
      cwd: workingDir,
    });
    return console.log(deny(`🔒 [branch-gate] 禁止在 ${branch} 分支写入文件。请切换到功能分支后再试。`));
  } catch (/** @type {unknown} */ e) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    console.log(allow());
  }
}

// 只在直接运行时执行 main，导入时不执行
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1]);
if (isDirectRun) {
  main();
}

export {
  MAIN_BRANCHES,
  SAFE_COMMAND_PATTERNS,
  FILE_WRITE_PATTERNS,
  log,
  getCurrentBranch,
  isInsideWorktree,
  isSafeCommand,
  isFileWriteCommand,
  getWritePatternName,
  allow,
  deny,
  main,
};
