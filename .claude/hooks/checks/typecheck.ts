import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { filterPathsByScope, getScanScope, getScopedStagedFiles } from './scan-scope.js';
import { listTrackedFiles } from './file-patterns.js';
import {
  denyIfPyrightMissing,
  denyIfToolMissing,
  denyOnToolError,
  getBunxInvocation,
  isPyrightAvailable,
} from './tools.js';
import { COMMIT_GATE_TIMEOUT_MS, FULL_GATE_TIMEOUT_MS, gateTimeoutMessage } from '../gate-timeouts.js';
import type { GateCheckRunOptions } from '../types.js';

interface TypecheckToolResult {
  tool?: string;
  stdout?: string;
  stderr?: string;
  success?: boolean;
}

function fulfilledToolResults(results: PromiseSettledResult<TypecheckToolResult>[]): TypecheckToolResult[] {
  return results
    .filter((r): r is PromiseFulfilledResult<TypecheckToolResult> => r.status === 'fulfilled')
    .map((r) => r.value);
}

function formatTypecheckToolOutput(result: TypecheckToolResult) {
  const text = [result.stderr, result.stdout]
    .filter((s) => typeof s === 'string' && s.trim())
    .join('\n')
    .trim();
  return text || `${result.tool ?? 'tool'}: failed (exit non-zero)`;
}

/** 检查 pyright --help 输出是否包含 --clear-cache 选项（纯函数，便于单测） */
export function helpTextSupportsClearCache(text: string): boolean {
  return text.includes('--clear-cache');
}

/** 通过 `pyright --help`（或 `uv run pyright --help`）探测是否支持 --clear-cache */
export function pyrightSupportsClearCache(cwd: string): boolean {
  const invocation = execCommand('which pyright', { cwd }).success ? 'pyright' : 'uv run pyright';
  const result = execCommand(`${invocation} --help`, { cwd, timeout: 10_000 });
  const text = `${result.stdout}\n${result.stderr}`;
  return helpTextSupportsClearCache(text);
}

async function runPyrightOnFiles(
  files: string[],
  cwd: string | undefined,
  timeoutMs: number,
): Promise<TypecheckToolResult> {
  if (files.length === 0) {
    return { tool: 'pyright', success: true, stdout: '无 .py 文件，跳过', stderr: '' };
  }
  const clearCache = pyrightSupportsClearCache(cwd ?? process.cwd()) ? '--clear-cache' : '';
  const fileArgs = files.map((f) => `"${f}"`).join(' ');
  if (execCommand('which pyright', { cwd }).success) {
    const cmd = `pyright ${clearCache} ${fileArgs}`.trim().replace(/\s+/g, ' ');
    return {
      tool: 'pyright',
      ...(await withTimeout(
        execCommandAsync(cmd, { cwd, timeout: timeoutMs }),
        timeoutMs,
        gateTimeoutMessage('pyright', timeoutMs),
      )),
    };
  }
  const cmd = `uv run pyright ${clearCache} ${fileArgs}`.trim().replace(/\s+/g, ' ');
  return {
    tool: 'pyright (uv)',
    ...(await withTimeout(
      execCommandAsync(cmd, { cwd, timeout: timeoutMs }),
      timeoutMs,
      gateTimeoutMessage('pyright', timeoutMs),
    )),
  };
}

async function runTsc(cwd: string | undefined, timeoutMs: number): Promise<TypecheckToolResult> {
  return {
    tool: 'tsc',
    ...(await withTimeout(
      execCommandAsync(`${getBunxInvocation(cwd)} tsc --noEmit`, { cwd, timeout: timeoutMs }),
      timeoutMs,
      gateTimeoutMessage('tsc', timeoutMs),
    )),
  };
}

export async function runStagedTypecheck(cwd?: string, options?: GateCheckRunOptions) {
  const timeoutMs = options?.timeoutMs ?? COMMIT_GATE_TIMEOUT_MS;
  const stagedFiles = getScopedStagedFiles(cwd);
  const stagedPyFiles = stagedFiles.filter((f) => f.endsWith('.py'));
  const stagedJsTsFiles = stagedFiles.filter((f) => /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(f));

  if (stagedPyFiles.length === 0 && stagedJsTsFiles.length === 0) {
    return formatResult('type-check', DECISION.SKIP, '暂存区无代码文件，跳过类型检查');
  }

  if (stagedPyFiles.length > 0) {
    const missing = denyIfPyrightMissing('type-check', cwd);
    if (missing) return missing;
  }

  const nonTestJsTsFiles = stagedJsTsFiles.filter(
    (f) => !f.includes('__tests__') && !f.includes('.test.') && !f.includes('.spec.'),
  );
  if (nonTestJsTsFiles.length > 0 && execCommand('test -f tsconfig.json', { cwd }).success) {
    const missing = denyIfToolMissing('bun', 'type-check', cwd);
    if (missing) return missing;
  }

  const pyrightPromise: Promise<TypecheckToolResult> =
    stagedPyFiles.length === 0
      ? Promise.resolve({ tool: 'pyright', success: true, stdout: '无暂存的 .py 文件，跳过', stderr: '' })
      : runPyrightOnFiles(stagedPyFiles, cwd, timeoutMs);

  const tscPromise: Promise<TypecheckToolResult> = (async () => {
    if (nonTestJsTsFiles.length === 0) {
      return { tool: 'tsc', success: true, stdout: '暂存区无非测试代码文件，跳过', stderr: '' };
    }
    if (!execCommand('test -f tsconfig.json', { cwd }).success) {
      return { tool: 'tsc', success: true, stdout: 'no tsconfig.json, skip', stderr: '' };
    }
    return runTsc(cwd, timeoutMs);
  })();

  try {
    const results = await Promise.allSettled([pyrightPromise, tscPromise]);
    const failures = fulfilledToolResults(results).filter((v) => !v.success);
    if (failures.length > 0) {
      const messages = failures.map((f) => formatTypecheckToolOutput(f)).join('\n\n');
      return formatResult('type-check', DECISION.DENY, `类型检查失败:\n${messages.slice(0, 800)}`, { failures });
    }
    return formatResult('type-check', DECISION.ALLOW, '类型检查通过');
  } catch (e) {
    return denyOnToolError(e, 'type-check', 'typecheck');
  }
}

export async function runFullTypecheck(cwd?: string, options?: GateCheckRunOptions) {
  const timeoutMs = options?.timeoutMs ?? FULL_GATE_TIMEOUT_MS;
  const root = cwd ?? process.cwd();
  const hasPyproject = execCommand('test -f pyproject.toml', { cwd }).success;
  const hasTsconfig = execCommand('test -f tsconfig.json', { cwd }).success;

  if (hasPyproject && !isPyrightAvailable(cwd)) {
    const missing = denyIfPyrightMissing('type-check', cwd);
    if (missing) return missing;
  }
  if (hasTsconfig) {
    const missing = denyIfToolMissing('bun', 'type-check', cwd);
    if (missing) return missing;
  }

  const scopedPyFiles = hasPyproject
    ? filterPathsByScope(
        listTrackedFiles((f) => f.endsWith('.py'), root),
        getScanScope(root),
      )
    : [];

  const pyrightPromise: Promise<TypecheckToolResult> = (async () => {
    if (!hasPyproject) {
      return { tool: 'pyright', success: true, stdout: 'no pyproject.toml, skip', stderr: '' };
    }
    if (scopedPyFiles.length === 0) {
      return { tool: 'pyright', success: true, stdout: 'scanScope 内无 .py 文件，跳过', stderr: '' };
    }
    return runPyrightOnFiles(scopedPyFiles, cwd, timeoutMs);
  })();

  const tscPromise: Promise<TypecheckToolResult> = (async () => {
    if (!hasTsconfig) {
      return { tool: 'tsc', success: true, stdout: 'no tsconfig.json, skip', stderr: '' };
    }
    return runTsc(cwd, timeoutMs);
  })();

  try {
    const results = await Promise.allSettled([pyrightPromise, tscPromise]);
    const failures = fulfilledToolResults(results).filter((v) => !v.success);
    if (failures.length > 0) {
      const messages = failures.map((f) => formatTypecheckToolOutput(f)).join('\n\n');
      return formatResult('type-check', DECISION.DENY, `类型检查失败:\n${messages.slice(0, 800)}`, { failures });
    }
    return formatResult('type-check', DECISION.ALLOW, '类型检查通过');
  } catch (e) {
    return denyOnToolError(e, 'type-check', 'typecheck');
  }
}
