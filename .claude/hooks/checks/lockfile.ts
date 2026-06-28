import { existsSync } from 'fs';
import { join } from 'path';
import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const FRESHNESS_TIMEOUT_MS = 30000;

/**
 * 校验 lockfile 新鲜度：依赖清单（package.json / pyproject.toml）变更后必须同步对应 lockfile。
 * - commit profile（staged=true）：仅在依赖清单被暂存时触发。
 * - full profile（staged=false）：只要存在清单与 lockfile 即校验。
 */
export function runLockfileFreshness(cwd: string = process.cwd(), options: GateCheckRunOptions = {}): CheckResult {
  const staged = options.staged === true;
  const timeoutMs = options.timeoutMs ?? FRESHNESS_TIMEOUT_MS;
  const stagedFiles = staged ? getStagedFiles(cwd) : [];
  const isStaged = (name: string): boolean => stagedFiles.some((f) => f.endsWith(name));

  const checked: string[] = [];
  const failures: string[] = [];

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，第二参为常量文件名
  const hasPackageJson = existsSync(join(cwd, 'package.json'));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，第二参为常量文件名
  const hasBunLock = existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'));
  const jsTrigger = staged ? isStaged('package.json') : hasPackageJson;
  if (jsTrigger && hasPackageJson && hasBunLock) {
    checked.push('bun');
    const r = execCommand('bun install --frozen-lockfile --dry-run', { cwd, timeout: timeoutMs });
    if (!r.success) {
      failures.push('package.json 与 bun.lock 不同步（请运行 bun install 并提交更新后的 bun.lock）');
    }
  }

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，第二参为常量文件名
  const hasPyproject = existsSync(join(cwd, 'pyproject.toml'));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，第二参为常量文件名
  const hasUvLock = existsSync(join(cwd, 'uv.lock'));
  const pyTrigger = staged ? isStaged('pyproject.toml') : hasPyproject;
  if (pyTrigger && hasPyproject && hasUvLock) {
    checked.push('uv');
    const r = execCommand('uv lock --check', { cwd, timeout: timeoutMs });
    if (!r.success) {
      failures.push('pyproject.toml 与 uv.lock 不同步（请运行 uv lock 并提交更新后的 uv.lock）');
    }
  }

  if (checked.length === 0) {
    return formatResult('lockfile-freshness', DECISION.SKIP, '无需校验 lockfile 新鲜度');
  }
  if (failures.length > 0) {
    return formatResult('lockfile-freshness', DECISION.DENY, failures.join('；'), { failures });
  }
  return formatResult('lockfile-freshness', DECISION.ALLOW, `lockfile 新鲜度校验通过（${checked.join(', ')}）`);
}
