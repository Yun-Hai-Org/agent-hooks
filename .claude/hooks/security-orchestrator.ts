#!/usr/bin/env bun
/**
 * Security Orchestrator - 共享安全决策模块
 * 提供统一的安全检查结果格式和决策引擎、Hook 输出、日志记录等
 */

import { exec, execSync, type ExecOptions, type ExecSyncOptions } from 'child_process';
import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { CheckResult, DecideResult, ExecResult, ToolAvailability, ToolchainInfo, Decision } from './types.js';
import { isExecErrorLike, stringifyUnknown } from './types.js';

export const DECISION = {
  ALLOW: 'allow',
  DENY: 'deny',
  WARN: 'warn',
  SKIP: 'skip',
} as const;

export const SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'moderate',
  LOW: 'low',
  INFO: 'info',
} as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const HOOKS_DIR = __dirname;
export const TESTS_DIR = join(__dirname, '__tests__');
export const LOG_DIR = join(process.env['HOME'] ?? '', '.claude', 'hooks-logs');

export function log(hookName: string, data: Record<string, unknown>): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    const entry = { ts: new Date().toISOString(), hook: hookName, ...data };
    appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch {
    // ignore log failures
  }
}

type ExecCommandOptions = ExecSyncOptions & { timeout?: number };

export function execCommand(command: string, options: ExecCommandOptions = {}): ExecResult {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      ...options,
    });
    return { success: true, stdout: String(result), stderr: '' };
  } catch (error: unknown) {
    if (isExecErrorLike(error)) {
      return {
        success: false,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message ?? stringifyUnknown(error),
      };
    }
    return { success: false, stdout: '', stderr: stringifyUnknown(error) };
  }
}

type ExecCommandAsyncOptions = ExecOptions & { timeout?: number };

export function execCommandAsync(command: string, options: ExecCommandAsyncOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const timeout = options.timeout ?? 30000;
    let settled = false;
    const finish = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = exec(
      command,
      {
        encoding: 'utf-8',
        timeout,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          finish({
            success: false,
            stdout: String(stdout),
            stderr: String(stderr || (error instanceof Error ? error.message : stringifyUnknown(error))),
          });
        } else {
          finish({ success: true, stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );

    setTimeout(() => {
      child.kill('SIGTERM');
      finish({
        success: false,
        stdout: '',
        stderr: `Command timed out after ${String(timeout)}ms`,
      });
    }, timeout + 1000);
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage = '操作超时'): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) clearTimeout(timeoutId);
  });
}

export function readStdin(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      input += chunk;
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(input) as Record<string, unknown>);
      } catch (e) {
        reject(new Error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

export async function safeMain(fn: () => Promise<void>): Promise<void> {
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

export function formatResult(
  checkId: string,
  decision: Decision,
  message: string,
  details: Record<string, unknown> = {},
): CheckResult {
  return { checkId, decision, message, timestamp: new Date().toISOString(), details };
}

export function decide(results: CheckResult[]): DecideResult {
  const denyResults = results.filter((r) => r.decision === DECISION.DENY);
  const warnResults = results.filter((r) => r.decision === DECISION.WARN);
  if (denyResults.length > 0) {
    return {
      decision: DECISION.DENY,
      reason: denyResults.map((r) => r.message).join('\n'),
      denyResults,
      warnResults,
    };
  }
  if (warnResults.length > 0) {
    return {
      decision: DECISION.WARN,
      reason: warnResults.map((r) => r.message).join('\n'),
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

export function formatHookOutput(decision: string, reason: string): string {
  if (decision === DECISION.ALLOW) return '{}';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

export function checkToolAvailable(toolName: string, cwd?: string): ToolAvailability {
  try {
    execSync(`which ${toolName}`, { cwd, stdio: 'pipe' });
    return { available: true };
  } catch {
    return { available: false, message: `${toolName} 未安装或不在 PATH 中` };
  }
}

export function detectToolchain(cwd?: string): ToolchainInfo {
  const dir = cwd ?? process.cwd();
  const checks: ToolchainInfo = {
    js: null,
    python: null,
  };

  try {
    const hasPackageJson = existsSync(join(dir, 'package.json'));
    if (hasPackageJson) {
      const hasBunLock = existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'));
      checks.js = hasBunLock ? 'bun' : 'node';
    }
  } catch {
    // ignore
  }

  try {
    const hasPyproject = existsSync(join(dir, 'pyproject.toml'));
    if (hasPyproject) {
      checks.python = 'uv';
    }
  } catch {
    // ignore
  }

  return checks;
}

export function isGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function getCurrentBranch(cwd: string): string | null {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

export function isGitIgnored(filePath: string, cwd = process.cwd()): boolean {
  const env: NodeJS.ProcessEnv = { ...process.env };
  try {
    const bare = execSync('git rev-parse --is-bare-repository', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (bare === 'true' && existsSync(join(cwd, '.gitignore'))) {
      env['GIT_WORK_TREE'] = cwd;
    }
  } catch {
    // fall through with default env
  }
  try {
    execSync(`git check-ignore -q "${filePath}"`, { cwd, stdio: 'pipe', env });
    return true;
  } catch {
    return false;
  }
}
