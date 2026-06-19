import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';

/** @param {string} [cwd] */
export async function runLintFull(cwd) {
  const results = [];
  const hasEslintConfig =
    execCommand('test -f eslint.config.js', { cwd }).success || execCommand('test -f .eslintrc.js', { cwd }).success;
  const hasPyproject = execCommand('test -f pyproject.toml', { cwd }).success;

  if (hasEslintConfig) {
    const missing = denyIfToolMissing('bun', 'lint-eslint', cwd);
    if (missing) return missing;
    try {
      const eslintResult = await withTimeout(
        execCommandAsync('bunx eslint . --max-warnings 0', { cwd, timeout: 120000 }),
        120000,
        'eslint 超时 (120s)',
      );
      results.push(
        eslintResult.success
          ? formatResult('lint-eslint', DECISION.ALLOW, 'ESLint 全量检查通过')
          : formatResult('lint-eslint', DECISION.DENY, 'ESLint 全量检查失败', {
              output: (eslintResult.stderr || eslintResult.stdout).slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, 'lint-eslint', 'eslint'));
    }
  }

  if (hasPyproject) {
    const missing = denyIfToolMissing('ruff', 'lint-ruff', cwd);
    if (missing) return missing;
    try {
      const ruffResult = await withTimeout(
        execCommandAsync('ruff check .', { cwd, timeout: 60000 }),
        60000,
        'ruff 超时 (60s)',
      );
      results.push(
        ruffResult.success
          ? formatResult('lint-ruff', DECISION.ALLOW, 'Ruff 全量检查通过')
          : formatResult('lint-ruff', DECISION.DENY, 'Ruff 全量检查失败', {
              output: (ruffResult.stderr || ruffResult.stdout).slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, 'lint-ruff', 'ruff'));
    }
  }

  if (results.length === 0) {
    return formatResult('lint-full', DECISION.SKIP, '未找到 lint 配置，跳过');
  }
  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure || formatResult('lint-full', DECISION.ALLOW, '全量 lint 通过');
}
