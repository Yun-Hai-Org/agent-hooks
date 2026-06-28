import { existsSync } from 'fs';
import { join } from 'path';
import { execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import { gateTimeoutMessage } from '../gate-timeouts.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const POLICY_DIRS = ['policy', '.hooks/policy'];
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

function resolvePolicyDir(cwd: string): string | null {
  for (const dir of POLICY_DIRS) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，dir 为常量策略目录名
    if (existsSync(join(cwd, dir))) return dir;
  }
  return null;
}

export async function runOpaConftest(cwd?: string, options?: GateCheckRunOptions): Promise<CheckResult> {
  const root = cwd ?? process.cwd();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const policyDir = resolvePolicyDir(root);

  if (!policyDir) {
    return formatResult('opa-conftest', DECISION.SKIP, '无 policy/ 或 .hooks/policy/ 目录，跳过 Conftest');
  }

  const missing = denyIfToolMissing('conftest', 'opa-conftest', root);
  if (missing) return missing;

  try {
    const result = await withTimeout(
      execCommandAsync(`conftest test --policy ${policyDir} --all-namespaces .`, { cwd: root, timeout: timeoutMs }),
      timeoutMs,
      gateTimeoutMessage('conftest', timeoutMs),
    );
    if (!result.success) {
      return formatResult('opa-conftest', DECISION.DENY, 'Conftest 策略检查失败', {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }
    return formatResult('opa-conftest', DECISION.ALLOW, 'Conftest OPA 策略检查通过');
  } catch (e) {
    return denyOnToolError(e, 'opa-conftest', 'conftest');
  }
}
