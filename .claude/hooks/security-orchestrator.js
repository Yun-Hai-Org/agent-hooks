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

export function log(hookName, data) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    const entry = { ts: new Date().toISOString(), hook: hookName, ...data };
    appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch {}
}

// ─── 命令执行 ────────────────────────────────────────────────────────────────

export function execCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      ...options,
    });
    return { success: true, stdout: result, stderr: '' };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
    };
  }
}

// ─── 带超时的 Promise ────────────────────────────────────────────────────────

export function withTimeout(promise, ms, timeoutMessage = '操作超时') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
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
        reject(new Error(`JSON 解析失败: ${e.message}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

// ─── 安全主函数 ──────────────────────────────────────────────────────────────

export async function safeMain(fn) {
  try {
    await fn();
  } catch (e) {
    log('unknown', { level: 'ERROR', error: e.message, stack: e.stack });
    console.log('{}');
    process.exit(0);
  }
}

// ─── 结果格式化 ──────────────────────────────────────────────────────────────

export function formatResult(checkId, decision, message, details = {}) {
  return { checkId, decision, message, timestamp: new Date().toISOString(), details };
}

// ─── 决策引擎 ────────────────────────────────────────────────────────────────

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

export function checkToolAvailable(toolName) {
  try {
    execSync(`which ${toolName}`, { stdio: 'pipe' });
    return { available: true };
  } catch {
    return { available: false, message: `${toolName} 未安装或不在 PATH 中` };
  }
}

// ─── Git 辅助函数 ────────────────────────────────────────────────────────────

export function isGitRepo(cwd) {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function getCurrentBranch(cwd) {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}
