import { getQualityGateExcludeReason } from '../gate-exclude.js';
import { log } from '../security-orchestrator.js';

export function exitIfQualityGateExcluded(hookName: string, cwd: string): void {
  const reason = getQualityGateExcludeReason(cwd);
  if (reason) {
    log(hookName, { level: 'SKIP', reason: `quality gate excluded: ${reason}`, cwd });
    process.exit(0);
  }
}
