import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { isOpenApiSpecPath, listTrackedFiles } from './file-patterns.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import type { CheckResult } from '../types.js';

const OASDIFF_STAGED_TIMEOUT_MS = 30000;
const OASDIFF_FULL_TIMEOUT_MS = 60000;

export function hasOpenApiBaseline(filePath: string, cwd?: string): boolean {
  const result = execCommand(`git cat-file -e "HEAD:${filePath}"`, { cwd, timeout: 5000 });
  return result.success;
}

async function runOasdiffBreaking(filePath: string, idPrefix: string, cwd?: string) {
  if (!hasOpenApiBaseline(filePath, cwd)) {
    return formatResult(`${idPrefix}-oasdiff`, DECISION.SKIP, `无 HEAD 基线，跳过 breaking 检测: ${filePath}`);
  }

  const cmd = `oasdiff breaking "HEAD:${filePath}" "${filePath}"`;
  try {
    const result = await withTimeout(
      execCommandAsync(cmd, { cwd, timeout: OASDIFF_STAGED_TIMEOUT_MS }),
      OASDIFF_STAGED_TIMEOUT_MS,
      `oasdiff 超时 (${String(OASDIFF_STAGED_TIMEOUT_MS / 1000)}s): ${filePath}`,
    );
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    if (!result.success) {
      return formatResult(`${idPrefix}-oasdiff`, DECISION.DENY, `OpenAPI breaking 变更: ${filePath}`, {
        output: output.slice(0, 500),
      });
    }
    return formatResult(`${idPrefix}-oasdiff`, DECISION.ALLOW, `OpenAPI 契约兼容: ${filePath}`);
  } catch (e) {
    return denyOnToolError(e, `${idPrefix}-oasdiff`, 'oasdiff');
  }
}

async function runOpenApiChecks(files: string[], idPrefix: string, cwd?: string, timeoutMs = OASDIFF_FULL_TIMEOUT_MS) {
  const missing = denyIfToolMissing('oasdiff', `${idPrefix}-oasdiff`, cwd);
  if (missing) return missing;

  const results: CheckResult[] = [];
  for (const file of files) {
    if (!hasOpenApiBaseline(file, cwd)) {
      results.push(formatResult(`${idPrefix}-oasdiff`, DECISION.SKIP, `无 HEAD 基线，跳过 breaking 检测: ${file}`));
      continue;
    }

    const cmd = `oasdiff breaking "HEAD:${file}" "${file}"`;
    try {
      const result = await withTimeout(
        execCommandAsync(cmd, { cwd, timeout: timeoutMs }),
        timeoutMs,
        `oasdiff 超时 (${String(timeoutMs / 1000)}s): ${file}`,
      );
      const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      results.push(
        result.success
          ? formatResult(`${idPrefix}-oasdiff`, DECISION.ALLOW, `OpenAPI 契约兼容: ${file}`)
          : formatResult(`${idPrefix}-oasdiff`, DECISION.DENY, `OpenAPI breaking 变更: ${file}`, {
              output: output.slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, `${idPrefix}-oasdiff`, 'oasdiff'));
    }
  }

  const failure = results.find((r) => r.decision === DECISION.DENY);
  if (failure) return failure;

  const checked = results.filter((r) => r.decision === DECISION.ALLOW);
  if (checked.length === 0) {
    return formatResult(idPrefix, DECISION.SKIP, 'OpenAPI spec 无 HEAD 基线，跳过 breaking 检测');
  }

  return formatResult(idPrefix, DECISION.ALLOW, `OpenAPI 契约检查通过（${String(checked.length)} 个 spec）`);
}

export async function runOpenApiContractStaged(cwd?: string) {
  const staged = getStagedFiles(cwd);
  const openApiFiles = staged.filter((f) => isOpenApiSpecPath(f, cwd));
  if (openApiFiles.length === 0) {
    return formatResult('openapi-staged', DECISION.SKIP, '暂存区无 OpenAPI spec，跳过');
  }

  const missing = denyIfToolMissing('oasdiff', 'openapi-staged-oasdiff', cwd);
  if (missing) return missing;

  const results: CheckResult[] = [];
  for (const file of openApiFiles) {
    results.push(await runOasdiffBreaking(file, 'openapi-staged', cwd));
  }

  const failure = results.find((r) => r.decision === DECISION.DENY);
  if (failure) return failure;

  const checked = results.filter((r) => r.decision === DECISION.ALLOW);
  if (checked.length === 0) {
    return formatResult('openapi-staged', DECISION.SKIP, '暂存 OpenAPI spec 无 HEAD 基线，跳过 breaking 检测');
  }

  return formatResult('openapi-staged', DECISION.ALLOW, `OpenAPI 契约检查通过（${String(checked.length)} 个 spec）`);
}

export async function runOpenApiContractFull(cwd?: string) {
  const openApiFiles = listTrackedFiles((f) => {
    if (f.startsWith('_bmad-output/') || f.startsWith('_bmad/')) return false;
    if (/\.github\/workflows\//i.test(f)) return false;
    return isOpenApiSpecPath(f, cwd);
  }, cwd);

  if (openApiFiles.length === 0) {
    return formatResult('openapi-full', DECISION.SKIP, '仓库无 OpenAPI spec，跳过');
  }

  return runOpenApiChecks(openApiFiles, 'openapi-full', cwd, OASDIFF_FULL_TIMEOUT_MS);
}
