import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import {
  denyIfToolMissing,
  denyOnToolError,
  denyIfRuffMissing,
  getBunxInvocation,
  getRuffInvocation,
} from './tools.js';
import { isHooksProject } from './hooks-project.js';
import { FULL_GATE_TIMEOUT_MS, gateTimeoutMessage } from '../gate-timeouts.js';
import { buildGateCheckPath, runWithAutoFixRetry } from '../gate-autofix.js';
import type { CheckResult, GateCheckRunOptions, GatePathPrefix } from '../types.js';

export async function runLintFull(cwd?: string, options?: GateCheckRunOptions) {
  const timeoutMs = options?.timeoutMs ?? FULL_GATE_TIMEOUT_MS;
  const gatePathPrefix: GatePathPrefix = options?.gatePathPrefix ?? 'git.pre-push';
  const root = cwd ?? process.cwd();
  const results: CheckResult[] = [];
  const hasEslintConfig =
    execCommand('test -f eslint.config.ts', { cwd }).success ||
    execCommand('test -f eslint.config.js', { cwd }).success ||
    execCommand('test -f .eslintrc.js', { cwd }).success;
  const hasPyproject = execCommand('test -f pyproject.toml', { cwd }).success;

  if (hasEslintConfig && isHooksProject(cwd)) {
    const missing = denyIfToolMissing('bun', 'lint-eslint', cwd);
    if (missing) return missing;
    const eslintPath = buildGateCheckPath(gatePathPrefix, 'lint-eslint');
    try {
      const eslintResult = await runWithAutoFixRetry(eslintPath, { cwd: root, timeoutMs }, async () => {
        const result = await withTimeout(
          execCommandAsync(
            `${getBunxInvocation(cwd)} eslint .claude/hooks --ignore-pattern "**/__tests__/**" --max-warnings 0 --report-unused-disable-directives`,
            { cwd, timeout: timeoutMs },
          ),
          timeoutMs,
          gateTimeoutMessage('eslint', timeoutMs),
        );
        return result.success
          ? formatResult('lint-eslint', DECISION.ALLOW, 'ESLint 全量检查通过')
          : formatResult('lint-eslint', DECISION.DENY, 'ESLint 全量检查失败', {
              output: (result.stderr || result.stdout).slice(0, 500),
            });
      });
      results.push(eslintResult);
    } catch (e) {
      results.push(denyOnToolError(e, 'lint-eslint', 'eslint'));
    }
  }

  if (hasPyproject) {
    const missing = denyIfRuffMissing('lint-ruff', cwd);
    if (missing) return missing;
    const ruff = getRuffInvocation(cwd);
    const ruffPath = buildGateCheckPath(gatePathPrefix, 'lint-ruff');
    try {
      const ruffResult = await runWithAutoFixRetry(ruffPath, { cwd: root, timeoutMs }, async () => {
        const result = await withTimeout(
          execCommandAsync(`${ruff} check --preview .`, { cwd, timeout: timeoutMs }),
          timeoutMs,
          gateTimeoutMessage('ruff', timeoutMs),
        );
        return result.success
          ? formatResult('lint-ruff', DECISION.ALLOW, 'Ruff 全量检查通过')
          : formatResult('lint-ruff', DECISION.DENY, 'Ruff 全量检查失败', {
              output: (result.stderr || result.stdout).slice(0, 500),
            });
      });
      results.push(ruffResult);
    } catch (e) {
      results.push(denyOnToolError(e, 'lint-ruff', 'ruff'));
    }
  }

  if (results.length === 0) {
    return formatResult('lint-full', DECISION.SKIP, '未找到 lint 配置，跳过');
  }
  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure ?? formatResult('lint-full', DECISION.ALLOW, '全量 lint 通过');
}
