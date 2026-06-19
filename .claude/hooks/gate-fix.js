import { summarizeResults } from './quality-gate.js';

/**
 * @param {string} gateName
 * @param {string} cmd
 * @param {{ results: { checkId: string; decision: string; message: string }[] }} gateResult
 * @param {{ loopCount?: number }} [options]
 */
export function buildGateDenyReason(gateName, cmd, gateResult, options = {}) {
  const results = gateResult.results || [];
  const denied = results.filter((r) => r.decision === 'deny');
  const summary =
    denied.length > 0 || results.length > 0
      ? summarizeResults(denied.length > 0 ? denied : results)
      : gateResult.decision?.reason || '检查未通过';
  const loopHint =
    typeof options.loopCount === 'number' && options.loopCount > 0
      ? `\n（第 ${options.loopCount + 1} 次修复重试）`
      : '';

  return [
    `🚫 [${gateName}] 质量门未通过，已阻止命令${loopHint}:`,
    `  ${cmd}`,
    '',
    summary,
    '',
    '请修复上述 ❌ 项，保存修改（auto-stage / auto-commit 会处理提交），然后重新执行同一命令。',
    '修复完成前请勿结束本轮；若尝试结束，Stop hook 会继续驱动修复直到检查通过。',
  ]
    .join('\n')
    .slice(0, 9500);
}

/**
 * @param {string} gateName
 * @param {string} cmd
 * @param {{ results: { checkId: string; decision: string; message: string }[] }} gateResult
 * @param {{ loopCount?: number }} [options]
 */
export function buildGateRetryStopMessage(gateName, cmd, gateResult, options = {}) {
  const results = gateResult.results || [];
  const denied = results.filter((r) => r.decision === 'deny');
  const summary =
    denied.length > 0 || results.length > 0
      ? summarizeResults(denied.length > 0 ? denied : results)
      : gateResult.decision?.reason || '检查未通过';
  const loopHint =
    typeof options.loopCount === 'number' && options.loopCount > 0
      ? `\n（第 ${options.loopCount + 1} 次自动重试）`
      : '';

  return [
    `[gate-retry] ${gateName} 仍未通过${loopHint}，待修复后请重新执行:`,
    `  ${cmd}`,
    '',
    summary,
    '',
    '修复步骤：',
    '1. 修复上述 ❌ 项',
    '2. 保存修改（auto-stage → auto-commit）',
    '3. 结束本轮后会再次检查；通过后请手动重新执行 push/merge 命令',
  ]
    .join('\n')
    .slice(0, 9500);
}

/** @param {string} gateName @param {string} cmd */
export function buildGateRetryPassMessage(gateName, cmd) {
  return [
    `[gate-retry] ${gateName} 检查已通过。`,
    '',
    '请手动重新执行之前被阻止的命令：',
    `  ${cmd}`,
  ].join('\n');
}
