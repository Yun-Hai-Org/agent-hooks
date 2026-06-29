import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import { gateTimeoutMessage } from '../gate-timeouts.js';
import { resolveScanTargets, getScanScope } from './scan-scope.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function hasIacTargets(cwd?: string): boolean {
  const root = cwd ?? process.cwd();
  const fileChecks = ['test -f Dockerfile', 'test -d terraform', 'test -d k8s'];
  if (fileChecks.some((p) => execCommand(p, { cwd: root }).success)) return true;

  for (const pattern of ['*.tf', 'k8s/*.yaml', '**/Dockerfile']) {
    const result = execCommand(`git ls-files "${pattern}"`, { cwd: root });
    if (result.success && result.stdout.trim().length > 0) return true;
  }
  return false;
}

export async function runIacCheckov(cwd?: string, options?: GateCheckRunOptions): Promise<CheckResult> {
  const root = cwd ?? process.cwd();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!hasIacTargets(root)) {
    return formatResult('iac-checkov', DECISION.SKIP, '无 IaC 目标文件，跳过 Checkov');
  }

  const missing = denyIfToolMissing('checkov', 'iac-checkov', root);
  if (missing) return missing;

  try {
    const scanTarget = resolveScanTargets(getScanScope(root));
    const result = await withTimeout(
      execCommandAsync(`checkov -d ${scanTarget} --framework terraform,kubernetes,dockerfile --quiet`, {
        cwd: root,
        timeout: timeoutMs,
      }),
      timeoutMs,
      gateTimeoutMessage('checkov', timeoutMs),
    );
    if (!result.success) {
      return formatResult('iac-checkov', DECISION.DENY, 'Checkov IaC 扫描失败', {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }
    return formatResult('iac-checkov', DECISION.ALLOW, 'Checkov IaC 扫描通过');
  } catch (e) {
    return denyOnToolError(e, 'iac-checkov', 'checkov');
  }
}
