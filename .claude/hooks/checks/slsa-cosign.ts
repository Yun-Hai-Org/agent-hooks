import { existsSync } from 'fs';
import { join } from 'path';
import { execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import { gateTimeoutMessage } from '../gate-timeouts.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const COSIGN_DIR = '.hooks/cosign';
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

export async function runSlsaCosign(cwd?: string, options?: GateCheckRunOptions): Promise<CheckResult> {
  const root = cwd ?? process.cwd();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- root 为受信仓库根，第二参为常量 COSIGN_DIR
  const configDir = join(root, COSIGN_DIR);

  if (!existsSync(configDir)) {
    return formatResult('slsa-cosign', DECISION.SKIP, '无 .hooks/cosign/ 配置，跳过 Cosign 校验');
  }

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- configDir 派生自受信 root 与常量目录
  const manifest = join(configDir, 'verify.sh');
  if (!existsSync(manifest)) {
    return formatResult('slsa-cosign', DECISION.SKIP, '无 .hooks/cosign/verify.sh，跳过 Cosign 校验');
  }

  const missing = denyIfToolMissing('cosign', 'slsa-cosign', root);
  if (missing) return missing;

  try {
    const result = await withTimeout(
      execCommandAsync(`bash "${manifest}"`, { cwd: root, timeout: timeoutMs }),
      timeoutMs,
      gateTimeoutMessage('cosign verify', timeoutMs),
    );
    if (!result.success) {
      return formatResult('slsa-cosign', DECISION.DENY, 'Cosign/SLSA 校验失败', {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }
    return formatResult('slsa-cosign', DECISION.ALLOW, 'Cosign/SLSA provenance 校验通过');
  } catch (e) {
    return denyOnToolError(e, 'slsa-cosign', 'cosign');
  }
}
