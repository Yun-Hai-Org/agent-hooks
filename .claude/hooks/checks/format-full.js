import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';

/** @param {string} [cwd] */
export async function runFormatFull(cwd) {
  const results = [];
  const hasPyproject = execCommand('test -f pyproject.toml', { cwd }).success;

  const bunMissing = denyIfToolMissing('bun', 'format-prettier', cwd);
  if (bunMissing) return bunMissing;

  try {
    const prettierResult = await withTimeout(
      execCommandAsync('bunx prettier --check .', { cwd, timeout: 120000 }),
      120000,
      'prettier 超时 (120s)',
    );
    results.push(
      prettierResult.success
        ? formatResult('format-prettier', DECISION.ALLOW, 'Prettier 格式检查通过')
        : formatResult('format-prettier', DECISION.DENY, 'Prettier 格式检查失败', {
            output: (prettierResult.stderr || prettierResult.stdout).slice(0, 500),
          }),
    );
  } catch (e) {
    results.push(denyOnToolError(e, 'format-prettier', 'prettier'));
  }

  if (hasPyproject) {
    const ruffMissing = denyIfToolMissing('ruff', 'format-ruff', cwd);
    if (ruffMissing) return ruffMissing;
    try {
      const ruffFmtResult = await withTimeout(
        execCommandAsync('ruff format --check .', { cwd, timeout: 60000 }),
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
  return failure || formatResult('format-full', DECISION.ALLOW, 'Format 检查通过');
}
