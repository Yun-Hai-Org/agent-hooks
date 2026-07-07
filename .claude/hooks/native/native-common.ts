import { getQualityGateExcludeReason } from '../gate-exclude.js';
import { resolveGateNode } from '../gate-config.js';
import { log } from '../security-orchestrator.js';

export function exitIfQualityGateExcluded(hookName: string, cwd: string): void {
  const reason = getQualityGateExcludeReason(cwd);
  if (reason) {
    log(hookName, { level: 'SKIP', reason: `quality gate excluded: ${reason}`, cwd });
    process.exit(0);
  }
}

export function exitIfGateHookDisabled(hookName: string, gateHookPath: string, cwd: string): void {
  const node = resolveGateNode(gateHookPath, cwd);
  if (!node.configured || !node.enabled) {
    log(hookName, {
      level: 'SKIP',
      reason: `${gateHookPath} 未在 quality-gate.yaml 中启用`,
      cwd,
    });
    process.exit(0);
  }
}
