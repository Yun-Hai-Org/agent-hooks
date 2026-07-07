import { summarizeResults } from './quality-gate.js';
import type { CheckResult, GateFixOptions } from './types.js';

interface GateResultLike {
  results?: CheckResult[];
  decision?: { reason?: string };
}

export function buildGateDenyReason(
  gateName: string,
  cmd: string,
  gateResult: GateResultLike,
  options: GateFixOptions = {},
): string {
  const results = gateResult.results ?? [];
  const denied = results.filter((r) => r.decision === 'deny');
  const summary =
    denied.length > 0 || results.length > 0
      ? summarizeResults(denied.length > 0 ? denied : results)
      : (gateResult.decision?.reason ?? '检查未通过');
  const loopHint =
    typeof options.loopCount === 'number' && options.loopCount > 0
      ? `\n（第 ${String(options.loopCount + 1)} 次修复重试）`
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

export function buildGateRetryStopMessage(
  gateName: string,
  cmd: string,
  gateResult: GateResultLike,
  options: GateFixOptions = {},
): string {
  const results = gateResult.results ?? [];
  const denied = results.filter((r) => r.decision === 'deny');
  const summary =
    denied.length > 0 || results.length > 0
      ? summarizeResults(denied.length > 0 ? denied : results)
      : (gateResult.decision?.reason ?? '检查未通过');
  const loopHint =
    typeof options.loopCount === 'number' && options.loopCount > 0
      ? `\n（第 ${String(options.loopCount + 1)} 次自动重试）`
      : '';
  const mergeHint =
    options.pendingType === 'merge'
      ? '\n4. merge 检查通过后将自动执行 git merge（GATE_AUTO_RETRY_MERGE=1）'
      : '\n4. 通过后请手动重新执行 push 命令';

  return [
    `[gate-retry] ${gateName} 仍未通过${loopHint}，待修复后请重新执行:`,
    `  ${cmd}`,
    '',
    summary,
    '',
    '修复步骤：',
    '1. 修复上述 ❌ 项',
    '2. 保存修改（auto-stage → auto-commit）',
    '3. 结束本轮后会再次检查',
    mergeHint,
  ]
    .join('\n')
    .slice(0, 9500);
}

export function buildGateRetryPassMessage(gateName: string, cmd: string, pendingType?: string): string {
  if (pendingType === 'merge') {
    return [`[gate-retry] ${gateName} 检查已通过。`, '', '请手动重新执行 merge 命令：', `  ${cmd}`].join('\n');
  }
  return [`[gate-retry] ${gateName} 检查已通过。`, '', '请手动重新执行之前被阻止的命令：', `  ${cmd}`].join('\n');
}

export function buildGateRetryMergeSuccessMessage(gateName: string, cmd: string, sha?: string): string {
  return [`[gate-retry] ${gateName} 检查已通过，已自动执行 merge。`, sha ? `合并提交: ${sha}` : '', `命令: ${cmd}`]
    .filter(Boolean)
    .join('\n');
}

export function buildGateRetryMergeFailureMessage(cmd: string, mergeError: string): string {
  return [
    '[gate-retry] 质量检查已通过，但 git merge 执行失败，请解决冲突或错误后重试：',
    `  ${cmd}`,
    '',
    mergeError.slice(0, 4000),
  ].join('\n');
}
