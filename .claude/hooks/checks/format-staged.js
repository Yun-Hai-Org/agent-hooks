import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';

/** @param {string} [cwd] */
export async function runFormatStaged(cwd) {
  const stagedFiles = getStagedFiles(cwd);
  const jsFiles = stagedFiles.filter((f) => /\.(js|ts|jsx|tsx|mjs|cjs|json|md|mdx|yaml|yml|css|scss)$/i.test(f));
  const pyFiles = stagedFiles.filter((f) => f.endsWith('.py'));

  if (jsFiles.length === 0 && pyFiles.length === 0) {
    return formatResult('format-staged', DECISION.SKIP, '暂存区无格式化目标文件，跳过');
  }

  const results = [];

  if (jsFiles.length > 0) {
    const missing = denyIfToolMissing('bun', 'format-staged-prettier', cwd);
    if (missing) return missing;
    const files = jsFiles.map((f) => `"${f}"`).join(' ');
    try {
      const prettierResult = await withTimeout(
        execCommandAsync(`bunx prettier --check ${files}`, { cwd, timeout: 30000 }),
        30000,
        'prettier staged 超时 (30s)',
      );
      results.push(
        prettierResult.success
          ? formatResult('format-staged-prettier', DECISION.ALLOW, 'Prettier 暂存文件格式检查通过')
          : formatResult('format-staged-prettier', DECISION.DENY, 'Prettier 暂存文件格式检查失败', {
              output: (prettierResult.stderr || prettierResult.stdout).slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, 'format-staged-prettier', 'prettier'));
    }
  }

  if (pyFiles.length > 0 && execCommand('test -f pyproject.toml', { cwd }).success) {
    const missing = denyIfToolMissing('ruff', 'format-staged-ruff', cwd);
    if (missing) return missing;
    const files = pyFiles.map((f) => `"${f}"`).join(' ');
    try {
      const ruffFmtResult = await withTimeout(
        execCommandAsync(`ruff format --check ${files}`, { cwd, timeout: 30000 }),
        30000,
        'ruff format staged 超时 (30s)',
      );
      results.push(
        ruffFmtResult.success
          ? formatResult('format-staged-ruff', DECISION.ALLOW, 'Ruff format 暂存文件检查通过')
          : formatResult('format-staged-ruff', DECISION.DENY, 'Ruff format 暂存文件检查失败', {
              output: (ruffFmtResult.stderr || ruffFmtResult.stdout).slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, 'format-staged-ruff', 'ruff format'));
    }
  }

  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure || formatResult('format-staged', DECISION.ALLOW, '暂存区 format 检查通过');
}
