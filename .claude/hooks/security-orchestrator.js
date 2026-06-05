#!/usr/bin/env bun
/**
 * Security Orchestrator - 共享安全决策模块
 * 提供统一的安全检查结果格式和决策引擎、Hook 输出、日志记录等
 */

import { execSync } from 'child_process';
import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── 常量 ───────────────────────────────────────────────────────────────────

export const DECISION = { ALLOW: 'allow', DENY: 'deny', WARN: 'warn', SKIP: 'skip' };
export const SEVERITY = { CRITICAL: 'critical', HIGH: 'high', MODERATE: 'moderate', LOW: 'low', INFO: 'info' };
const LOG_DIR = join(process.env.HOME || '', '.claude', 'hooks-logs');

// ─── 日志 ────────────────────────────────────────────────────────────────────

/**
 * @param {string} hookName
 * @param {Record<string, unknown>} data
 */
export function log(hookName, data) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    const entry = { ts: new Date().toISOString(), hook: hookName, ...data };
    appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch {}
}

// ─── 命令执行 ────────────────────────────────────────────────────────────────

/**
 * @param {string} command
 * @param {import('child_process').ExecSyncOptionsWithBufferEncoding & { timeout?: number }} [options]
 */
export function execCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      ...options,
    });
    return { success: true, stdout: result, stderr: '' };
  } catch (/** @type {any} */ error) {
    return {
      success: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || String(error),
    };
  }
}

// 异步版本的命令执行（支持 withTimeout 正确中断）
/**
 * @param {string} command
 * @param {{ timeout?: number } & import('child_process').ExecOptions} [options]
 */
export function execCommandAsync(command, options = {}) {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    /** @type {number} */
    const timeout = options.timeout || 30000;

    const child = exec(
      command,
      {
        encoding: 'utf-8',
        timeout,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            stdout: stdout || '',
            stderr: stderr || (error instanceof Error ? error.message : String(error)),
          });
        } else {
          resolve({ success: true, stdout, stderr: '' });
        }
      },
    );

    // 超时保护
    setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        stdout: '',
        stderr: `Command timed out after ${timeout}ms`,
      });
    }, timeout + 1000);
  });
}

// ─── 带超时的 Promise ────────────────────────────────────────────────────────

/**
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} [timeoutMessage]
 * @template T
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, timeoutMessage = '操作超时') {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) clearTimeout(timeoutId);
  });
}

// ─── stdin 读取 ──────────────────────────────────────────────────────────────

export function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(input));
      } catch (e) {
        reject(new Error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

// ─── 安全主函数 ──────────────────────────────────────────────────────────────

/**
 * @param {() => Promise<void>} fn
 */
export async function safeMain(fn) {
  try {
    await fn();
  } catch (e) {
    log('unknown', {
      level: 'ERROR',
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : '',
    });
    console.log('{}');
    process.exit(0);
  }
}

// ─── 结果格式化 ──────────────────────────────────────────────────────────────

/**
 * @param {string} checkId
 * @param {string} decision
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
export function formatResult(checkId, decision, message, details = {}) {
  return { checkId, decision, message, timestamp: new Date().toISOString(), details };
}

// ─── 决策引擎 ────────────────────────────────────────────────────────────────

/**
 * @param {Array<{ checkId: string; decision: string; message: string; timestamp?: string; details?: Record<string, unknown> }>} results
 */
export function decide(results) {
  const denyResults = results.filter((r) => r.decision === DECISION.DENY);
  const warnResults = results.filter((r) => r.decision === DECISION.WARN);
  if (denyResults.length > 0) {
    return {
      decision: DECISION.DENY,
      reason: denyResults.map((r) => `${r.message}`).join('\n'),
      denyResults,
      warnResults,
    };
  }
  if (warnResults.length > 0) {
    return {
      decision: DECISION.WARN,
      reason: warnResults.map((r) => `${r.message}`).join('\n'),
      denyResults,
      warnResults,
    };
  }
  return {
    decision: DECISION.ALLOW,
    reason: '所有检查通过',
    denyResults: [],
    warnResults: [],
  };
}

// ─── Hook 输出格式化 ─────────────────────────────────────────────────────────

/**
 * @param {string} decision
 * @param {string} reason
 */
export function formatHookOutput(decision, reason) {
  if (decision === DECISION.ALLOW) return '{}';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

// ─── 工具可用性检测 ──────────────────────────────────────────────────────────

/**
 * @param {string} toolName
 */
export function checkToolAvailable(toolName) {
  try {
    execSync(`which ${toolName}`, { stdio: 'pipe' });
    return { available: true };
  } catch {
    return { available: false, message: `${toolName} 未安装或不在 PATH 中` };
  }
}

// ─── Git 辅助函数 ────────────────────────────────────────────────────────────

/**
 * @param {string} cwd
 */
export function isGitRepo(cwd) {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} cwd
 */
export function getCurrentBranch(cwd) {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/**
 * @param {string} filePath
 * @param {string} cwd
 */
export function isGitIgnored(filePath, cwd) {
  try {
    execSync(`git check-ignore -q "${filePath}"`, { cwd, stdio: 'pipe' });
    return true; // exit 0 = is ignored
  } catch {
    return false; // exit non-zero = not ignored
  }
}
