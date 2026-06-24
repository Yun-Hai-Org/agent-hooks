import { execCommand, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { denyIfPyrightMissing, denyIfToolMissing, denyOnToolError, isPyrightAvailable } from './tools.js';

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

export async function runStagedTypecheck(cwd?: string) {
  const stagedFiles = getStagedFiles(cwd);
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

  const pyrightPromise = new Promise((resolve) => {
    if (stagedPyFiles.length === 0) {
      resolve({ tool: 'pyright', success: true, stdout: '无暂存的 .py 文件，跳过', stderr: '' });
      return;
    }
    if (execCommand('which pyright', { cwd }).success) {
      const files = stagedPyFiles.map((f) => `"${f}"`).join(' ');
      resolve({ tool: 'pyright', ...execCommand(`pyright ${files}`, { cwd, timeout: 30000 }) });
      return;
    }
    const files = stagedPyFiles.map((f) => `"${f}"`).join(' ');
    resolve({ tool: 'pyright (uv)', ...execCommand(`uv run pyright ${files}`, { cwd, timeout: 30000 }) });
  });

  const tscPromise = new Promise((resolve) => {
    if (nonTestJsTsFiles.length === 0) {
      resolve({ tool: 'tsc', success: true, stdout: '暂存区无非测试代码文件，跳过', stderr: '' });
      return;
    }
    if (!execCommand('test -f tsconfig.json', { cwd }).success) {
      resolve({ tool: 'tsc', success: true, stdout: 'no tsconfig.json, skip', stderr: '' });
      return;
    }
    resolve({ tool: 'tsc', ...execCommand('bunx tsc --noEmit', { cwd, timeout: 30000 }) });
  });

  try {
    const results = await Promise.allSettled([
      withTimeout(pyrightPromise, 30000, 'pyright 超时 (30s)'),
      withTimeout(tscPromise, 30000, 'tsc 超时 (30s)'),
    ]);
    const failures = fulfilledToolResults(results as PromiseSettledResult<TypecheckToolResult>[]).filter(
      (v) => !v.success,
    );
    if (failures.length > 0) {
      const messages = failures.map((f) => formatTypecheckToolOutput(f)).join('\n\n');
      return formatResult('type-check', DECISION.DENY, `类型检查失败:\n${messages.slice(0, 800)}`, { failures });
    }
    return formatResult('type-check', DECISION.ALLOW, '类型检查通过');
  } catch (e) {
    return denyOnToolError(e, 'type-check', 'typecheck');
  }
}

export async function runFullTypecheck(cwd?: string) {
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

  const pyrightPromise = new Promise((resolve) => {
    if (!hasPyproject) {
      resolve({ tool: 'pyright', success: true, stdout: 'no pyproject.toml, skip', stderr: '' });
      return;
    }
    if (execCommand('which pyright', { cwd }).success) {
      resolve({ tool: 'pyright', ...execCommand('pyright', { cwd, timeout: 60000 }) });
      return;
    }
    resolve({ tool: 'pyright (uv)', ...execCommand('uv run pyright', { cwd, timeout: 60000 }) });
  });

  const tscPromise = new Promise((resolve) => {
    if (!hasTsconfig) {
      resolve({ tool: 'tsc', success: true, stdout: 'no tsconfig.json, skip', stderr: '' });
      return;
    }
    resolve({ tool: 'tsc', ...execCommand('bunx tsc --noEmit', { cwd, timeout: 60000 }) });
  });

  try {
    const results = await Promise.allSettled([
      withTimeout(pyrightPromise, 60000, 'pyright 超时 (60s)'),
      withTimeout(tscPromise, 60000, 'tsc 超时 (60s)'),
    ]);
    const failures = fulfilledToolResults(results as PromiseSettledResult<TypecheckToolResult>[]).filter(
      (v) => !v.success,
    );
    if (failures.length > 0) {
      const messages = failures.map((f) => formatTypecheckToolOutput(f)).join('\n\n');
      return formatResult('type-check', DECISION.DENY, `类型检查失败:\n${messages.slice(0, 800)}`, { failures });
    }
    return formatResult('type-check', DECISION.ALLOW, '类型检查通过');
  } catch (e) {
    return denyOnToolError(e, 'type-check', 'typecheck');
  }
}
