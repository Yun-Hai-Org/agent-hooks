import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';

/** @param {string} tool @param {string} [cwd] */
export function isToolInstalled(tool, cwd) {
  return execCommand(`which ${tool}`, { cwd }).success;
}

/**
 * @param {string} tool
 * @param {string} checkId
 * @param {string} [cwd]
 */
export function denyIfToolMissing(tool, checkId, cwd) {
  if (!isToolInstalled(tool, cwd)) {
    return formatResult(checkId, DECISION.DENY, `${tool} 未安装，请先安装 ${tool}`);
  }
  return null;
}

/** @param {string} [cwd] */
export function isPyrightAvailable(cwd) {
  return isToolInstalled('pyright', cwd) || isToolInstalled('uv', cwd);
}

/** @param {string} checkId @param {string} [cwd] */
export function denyIfPyrightMissing(checkId, cwd) {
  if (!isPyrightAvailable(cwd)) {
    return formatResult(checkId, DECISION.DENY, 'pyright 未安装（需 pyright 或 uv），请先安装');
  }
  return null;
}

/**
 * @param {unknown} error
 * @param {string} checkId
 * @param {string} tool
 */
export function denyOnToolError(error, checkId, tool) {
  const message = error instanceof Error ? error.message : String(error);
  return formatResult(checkId, DECISION.DENY, `${tool} 执行失败: ${message}`);
}
