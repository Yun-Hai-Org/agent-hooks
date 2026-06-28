import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import { gateTimeoutMessage } from '../gate-timeouts.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

export function resolveCosignDir(cwd: string): string | null {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，第二段为常量 cosign 目录
  const candidates = [join(cwd, '.hooks/cosign'), join(homedir(), '.claude', 'cosign')];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

export async function runSlsaCosign(cwd?: string, options?: GateCheckRunOptions): Promise<CheckResult> {
  const root = cwd ?? process.cwd();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const configDir = resolveCosignDir(root);

  if (!configDir) {
    return formatResult(
      'slsa-cosign',
      DECISION.DENY,
      '无 .hooks/cosign/ 或 ~/.claude/cosign/ 配置，Cosign 校验失败（fail-closed）',
    );
  }

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- configDir 为受信 cosign 配置目录
  const manifest = join(configDir, 'verify.sh');
  if (!existsSync(manifest)) {
    return formatResult('slsa-cosign', DECISION.DENY, '无 verify.sh，Cosign 校验失败（fail-closed）');
  }

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- configDir 为受信 cosign 配置目录
  const artifacts = join(configDir, 'artifacts.txt');
  if (existsSync(artifacts)) {
    const missing = denyIfToolMissing('cosign', 'slsa-cosign', root);
    if (missing) return missing;
  }

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
