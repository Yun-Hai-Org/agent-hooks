/** commit profile 单项检查超时预算：5 分钟 */
export const COMMIT_GATE_TIMEOUT_MS = 5 * 60 * 1000;

/** full profile 单项检查超时预算：30 分钟 */
export const FULL_GATE_TIMEOUT_MS = 30 * 60 * 1000;

export function formatGateTimeoutLabel(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec >= 60 && totalSec % 60 === 0) {
    return `${String(totalSec / 60)}min`;
  }
  return `${String(totalSec)}s`;
}

export function gateTimeoutMessage(tool: string, ms: number): string {
  return `${tool} 超时 (${formatGateTimeoutLabel(ms)})`;
}
