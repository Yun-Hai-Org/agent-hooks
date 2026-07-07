import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { filterExistingStagedFiles } from './git-policy.js';
import { getScopedStagedFiles } from './scan-scope.js';
import {
  denyIfToolMissing,
  denyOnToolError,
  denyIfRuffMissing,
  getBunxInvocation,
  getRuffInvocation,
} from './tools.js';
import { buildGateCheckPath, runWithAutoFixRetry } from '../gate-autofix.js';
import { COMMIT_GATE_TIMEOUT_MS, gateTimeoutMessage } from '../gate-timeouts.js';
import type { CheckResult, GateCheckRunOptions, GatePathPrefix } from '../types.js';

export async function runFormatStaged(cwd?: string, options?: GateCheckRunOptions) {
  const timeoutMs = options?.timeoutMs ?? COMMIT_GATE_TIMEOUT_MS;
  const gatePathPrefix: GatePathPrefix = options?.gatePathPrefix ?? 'git.pre-commit';
  const root = cwd ?? process.cwd();
  const stagedFiles = filterExistingStagedFiles(getScopedStagedFiles(cwd), cwd);
  const jsFiles = stagedFiles.filter(
    (f) =>
      /\.(js|ts|jsx|tsx|mjs|cjs|json|md|mdx|yaml|yml|css|scss|less)$/i.test(f) &&
      !f.endsWith('.lock') &&
      !f.includes('bun.lock'),
  );
  const pyFiles = stagedFiles.filter((f) => f.endsWith('.py'));

  if (jsFiles.length === 0 && pyFiles.length === 0) {
    return formatResult('format-staged', DECISION.SKIP, '暂存区无格式化目标文件，跳过');
  }

  const results: CheckResult[] = [];

  if (jsFiles.length > 0) {
    const missing = denyIfToolMissing('bun', 'format-staged-prettier', cwd);
    if (missing) return missing;
    const files = jsFiles.map((f) => `"${f}"`).join(' ');
    const prettierPath = buildGateCheckPath(gatePathPrefix, 'format-staged-prettier');
    try {
      const prettierResult = await runWithAutoFixRetry(
        prettierPath,
        { cwd: root, files: jsFiles, timeoutMs },
        async () => {
          const result = await withTimeout(
            execCommandAsync(`${getBunxInvocation(cwd)} prettier --check ${files}`, { cwd, timeout: timeoutMs }),
            timeoutMs,
            gateTimeoutMessage('prettier staged', timeoutMs),
          );
          return result.success
            ? formatResult('format-staged-prettier', DECISION.ALLOW, 'Prettier 暂存文件格式检查通过')
            : formatResult('format-staged-prettier', DECISION.DENY, 'Prettier 暂存文件格式检查失败', {
                output: (result.stderr || result.stdout).slice(0, 500),
              });
        },
      );
      results.push(prettierResult);
    } catch (e) {
      results.push(denyOnToolError(e, 'format-staged-prettier', 'prettier'));
    }
  }

  if (pyFiles.length > 0 && execCommand('test -f pyproject.toml', { cwd }).success) {
    const missing = denyIfRuffMissing('format-staged-ruff', cwd);
    if (missing) return missing;
    const files = pyFiles.map((f) => `"${f}"`).join(' ');
    const ruff = getRuffInvocation(cwd);
    const ruffPath = buildGateCheckPath(gatePathPrefix, 'format-staged-ruff');
    try {
      const ruffFmtResult = await runWithAutoFixRetry(ruffPath, { cwd: root, files: pyFiles, timeoutMs }, async () => {
        const result = await withTimeout(
          execCommandAsync(`${ruff} format --check ${files}`, { cwd, timeout: timeoutMs }),
          timeoutMs,
          gateTimeoutMessage('ruff format staged', timeoutMs),
        );
        return result.success
          ? formatResult('format-staged-ruff', DECISION.ALLOW, 'Ruff format 暂存文件检查通过')
          : formatResult('format-staged-ruff', DECISION.DENY, 'Ruff format 暂存文件检查失败', {
              output: (result.stderr || result.stdout).slice(0, 500),
            });
      });
      results.push(ruffFmtResult);
    } catch (e) {
      results.push(denyOnToolError(e, 'format-staged-ruff', 'ruff format'));
    }
  }

  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure ?? formatResult('format-staged', DECISION.ALLOW, '暂存区 format 检查通过');
}
