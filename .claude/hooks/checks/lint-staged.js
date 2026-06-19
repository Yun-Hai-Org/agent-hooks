import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';

/** @param {string} [cwd] */
export async function runLintStaged(cwd) {
  const stagedFiles = getStagedFiles(cwd);
  const jsFiles = stagedFiles.filter((f) => /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(f));
  const pyFiles = stagedFiles.filter((f) => f.endsWith('.py'));

  if (jsFiles.length === 0 && pyFiles.length === 0) {
    return formatResult('lint-staged', DECISION.SKIP, '暂存区无 JS/TS/Python 文件，跳过 lint');
  }

  const results = [];
  const hasEslintConfig =
    execCommand('test -f eslint.config.js', { cwd }).success || execCommand('test -f .eslintrc.js', { cwd }).success;

  if (jsFiles.length > 0 && hasEslintConfig) {
    const missing = denyIfToolMissing('bun', 'lint-staged-eslint', cwd);
    if (missing) return missing;
    const files = jsFiles.map((f) => `"${f}"`).join(' ');
    try {
      const eslintResult = await withTimeout(
        execCommandAsync(`bunx eslint ${files} --max-warnings 0`, { cwd, timeout: 30000 }),
        30000,
        'eslint staged 超时 (30s)',
      );
      results.push(
        eslintResult.success
          ? formatResult('lint-staged-eslint', DECISION.ALLOW, 'ESLint 暂存文件检查通过')
          : formatResult('lint-staged-eslint', DECISION.DENY, 'ESLint 暂存文件检查失败', {
              output: (eslintResult.stderr || eslintResult.stdout).slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, 'lint-staged-eslint', 'eslint'));
    }
  }

  if (pyFiles.length > 0 && execCommand('test -f pyproject.toml', { cwd }).success) {
    const missing = denyIfToolMissing('ruff', 'lint-staged-ruff', cwd);
    if (missing) return missing;
    const files = pyFiles.map((f) => `"${f}"`).join(' ');
    try {
      const ruffResult = await withTimeout(
        execCommandAsync(`ruff check ${files}`, { cwd, timeout: 30000 }),
        30000,
        'ruff staged 超时 (30s)',
      );
      results.push(
        ruffResult.success
          ? formatResult('lint-staged-ruff', DECISION.ALLOW, 'Ruff 暂存文件检查通过')
          : formatResult('lint-staged-ruff', DECISION.DENY, 'Ruff 暂存文件检查失败', {
              output: (ruffResult.stderr || ruffResult.stdout).slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, 'lint-staged-ruff', 'ruff'));
    }
  }

  if (results.length === 0) {
    return formatResult('lint-staged', DECISION.SKIP, '暂存文件无需 lint 或未配置 lint');
  }
  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure || formatResult('lint-staged', DECISION.ALLOW, '暂存区 lint 通过');
}
