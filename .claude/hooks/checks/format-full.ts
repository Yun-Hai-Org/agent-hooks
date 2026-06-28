import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { listTrackedFiles } from './file-patterns.js';
import {
  denyIfToolMissing,
  denyOnToolError,
  denyIfRuffMissing,
  getBunxInvocation,
  getRuffInvocation,
} from './tools.js';
import { FULL_GATE_TIMEOUT_MS, gateTimeoutMessage } from '../gate-timeouts.js';
import { buildGateCheckPath, runWithAutoFixRetry } from '../gate-autofix.js';
import type { CheckResult, GateCheckRunOptions, GatePathPrefix } from '../types.js';

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

async function runPrettierFullCheck(
  cwd: string | undefined,
  root: string,
  prettierFiles: string[],
  gatePathPrefix: GatePathPrefix,
  timeoutMs: number,
): Promise<CheckResult> {
  const bunMissing = denyIfToolMissing('bun', 'format-prettier', cwd);
  if (bunMissing) return bunMissing;

  const prettierPath = buildGateCheckPath(gatePathPrefix, 'format-prettier');
  return runWithAutoFixRetry(prettierPath, { cwd: root, files: prettierFiles, timeoutMs }, async () => {
    const bunx = getBunxInvocation(cwd);
    const batches = chunkPrettierFiles(prettierFiles);
    for (const batch of batches) {
      const files = batch.map((f) => `"${f}"`).join(' ');
      try {
        const prettierResult = await withTimeout(
          execCommandAsync(`${bunx} prettier --check ${files}`, { cwd, timeout: PRETTIER_FULL_TIMEOUT_MS }),
          PRETTIER_FULL_TIMEOUT_MS,
          gateTimeoutMessage('prettier', PRETTIER_FULL_TIMEOUT_MS),
        );
        if (!prettierResult.success) {
          return formatResult('format-prettier', DECISION.DENY, 'Prettier 格式检查失败', {
            output: (prettierResult.stderr || prettierResult.stdout).slice(0, 500),
          });
        }
      } catch (e) {
        return denyOnToolError(e, 'format-prettier', 'prettier');
      }
    }
    return formatResult('format-prettier', DECISION.ALLOW, 'Prettier 格式检查通过');
  });
}

export async function runFormatFull(cwd?: string, options?: GateCheckRunOptions) {
  const gatePathPrefix: GatePathPrefix = options?.gatePathPrefix ?? 'git.pre-push';
  const root = cwd ?? process.cwd();
  const timeoutMs = options?.timeoutMs ?? FULL_GATE_TIMEOUT_MS;
  const results: CheckResult[] = [];
  const hasPyproject = execCommand('test -f pyproject.toml', { cwd }).success;

  const prettierFiles = listTrackedFiles(isPrettierFullTarget, cwd);
  if (prettierFiles.length === 0) {
    results.push(formatResult('format-prettier', DECISION.SKIP, '无 tracked prettier 目标文件，跳过'));
  } else {
    results.push(await runPrettierFullCheck(cwd, root, prettierFiles, gatePathPrefix, timeoutMs));
  }

  if (hasPyproject) {
    const ruffMissing = denyIfRuffMissing('format-ruff', cwd);
    if (ruffMissing) return ruffMissing;
    const ruff = getRuffInvocation(cwd);
    const ruffPath = buildGateCheckPath(gatePathPrefix, 'format-ruff');
    try {
      const ruffFmtResult = await runWithAutoFixRetry(ruffPath, { cwd: root, timeoutMs }, async () => {
        const result = await withTimeout(
          execCommandAsync(`${ruff} format --check .`, { cwd, timeout: 60000 }),
          60000,
          gateTimeoutMessage('ruff format', 60000),
        );
        return result.success
          ? formatResult('format-ruff', DECISION.ALLOW, 'Ruff format 检查通过')
          : formatResult('format-ruff', DECISION.DENY, 'Ruff format 检查失败', {
              output: (result.stderr || result.stdout).slice(0, 500),
            });
      });
      results.push(ruffFmtResult);
    } catch (e) {
      results.push(denyOnToolError(e, 'format-ruff', 'ruff format'));
    }
  }

  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure ?? formatResult('format-full', DECISION.ALLOW, 'Format 检查通过');
}
