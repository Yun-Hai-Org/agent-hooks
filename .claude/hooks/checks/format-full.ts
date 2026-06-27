import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { listTrackedFiles } from './file-patterns.js';
import {
  denyIfToolMissing,
  denyOnToolError,
  denyIfRuffMissing,
  getBunxInvocation,
  getRuffInvocation,
} from './tools.js';
import type { CheckResult } from '../types.js';

export const PRETTIER_FULL_TIMEOUT_MS = 300000;
export const PRETTIER_FULL_BATCH_SIZE = 200;

export function isPrettierFullTarget(file: string): boolean {
  return (
    /\.(js|ts|jsx|tsx|mjs|cjs|json|md|mdx|yaml|yml|css|scss|less)$/i.test(file) &&
    !file.endsWith('.lock') &&
    !file.includes('bun.lock')
  );
}

export function chunkPrettierFiles(files: string[], batchSize = PRETTIER_FULL_BATCH_SIZE): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < files.length; i += batchSize) {
    batches.push(files.slice(i, i + batchSize));
  }
  return batches;
}

export async function runFormatFull(cwd?: string) {
  const results: CheckResult[] = [];
  const hasPyproject = execCommand('test -f pyproject.toml', { cwd }).success;

  const prettierFiles = listTrackedFiles(isPrettierFullTarget, cwd);
  if (prettierFiles.length === 0) {
    results.push(formatResult('format-prettier', DECISION.SKIP, '无 tracked prettier 目标文件，跳过'));
  } else {
    const bunMissing = denyIfToolMissing('bun', 'format-prettier', cwd);
    if (bunMissing) return bunMissing;

    const bunx = getBunxInvocation(cwd);
    const batches = chunkPrettierFiles(prettierFiles);
    let prettierFailed: CheckResult | null = null;

    for (const batch of batches) {
      const files = batch.map((f) => `"${f}"`).join(' ');
      try {
        const prettierResult = await withTimeout(
          execCommandAsync(`${bunx} prettier --check ${files}`, { cwd, timeout: PRETTIER_FULL_TIMEOUT_MS }),
          PRETTIER_FULL_TIMEOUT_MS,
          `prettier 超时 (${String(PRETTIER_FULL_TIMEOUT_MS / 1000)}s)`,
        );
        if (!prettierResult.success) {
          prettierFailed = formatResult('format-prettier', DECISION.DENY, 'Prettier 格式检查失败', {
            output: (prettierResult.stderr || prettierResult.stdout).slice(0, 500),
          });
          break;
        }
      } catch (e) {
        prettierFailed = denyOnToolError(e, 'format-prettier', 'prettier');
        break;
      }
    }

    results.push(prettierFailed ?? formatResult('format-prettier', DECISION.ALLOW, 'Prettier 格式检查通过'));
  }

  if (hasPyproject) {
    const ruffMissing = denyIfRuffMissing('format-ruff', cwd);
    if (ruffMissing) return ruffMissing;
    const ruff = getRuffInvocation(cwd);
    try {
      const ruffFmtResult = await withTimeout(
        execCommandAsync(`${ruff} format --check .`, { cwd, timeout: 60000 }),
        60000,
        'ruff format 超时 (60s)',
      );
      results.push(
        ruffFmtResult.success
          ? formatResult('format-ruff', DECISION.ALLOW, 'Ruff format 检查通过')
          : formatResult('format-ruff', DECISION.DENY, 'Ruff format 检查失败', {
              output: (ruffFmtResult.stderr || ruffFmtResult.stdout).slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, 'format-ruff', 'ruff format'));
    }
  }

  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure ?? formatResult('format-full', DECISION.ALLOW, 'Format 检查通过');
}
