import { existsSync } from 'fs';
import { join } from 'path';
import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import { gateTimeoutMessage } from '../gate-timeouts.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function findOpenApiSpec(cwd: string): string | null {
  const candidates = ['openapi.yaml', 'openapi.yml', 'openapi.json', 'docs/openapi.yaml', 'api/openapi.yaml'];
  for (const c of candidates) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，c 为常量候选路径
    if (existsSync(join(cwd, c))) return c;
  }
  const result = execCommand('git ls-files "*openapi*.yaml" "*openapi*.yml" "*openapi*.json" | head -1', { cwd });
  return result.success && result.stdout.trim() ? result.stdout.trim() : null;
}

export async function runZapApiDast(cwd?: string, options?: GateCheckRunOptions): Promise<CheckResult> {
  const root = cwd ?? process.cwd();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const targetUrl = process.env['ZAP_TARGET_URL']?.trim();

  if (!targetUrl) {
    return formatResult('zap-api-dast', DECISION.SKIP, '未设置 ZAP_TARGET_URL，跳过 DAST');
  }

  const spec = findOpenApiSpec(root);
  if (!spec) {
    return formatResult('zap-api-dast', DECISION.SKIP, '未找到 OpenAPI spec，跳过 ZAP API scan');
  }

  const hasZap = execCommand('command -v zap.sh || command -v zaproxy', { cwd: root }).success;
  if (!hasZap) {
    const missing = denyIfToolMissing('zap', 'zap-api-dast', root);
    return missing ?? formatResult('zap-api-dast', DECISION.SKIP, 'ZAP 未安装，跳过');
  }

  const zapBin = execCommand('command -v zap.sh', { cwd: root }).success ? 'zap.sh' : 'zaproxy';
  const cmd = `${zapBin} -cmd -autorun /dev/stdin <<'EOF'
env:
  parameters:
    failOnError: true
    failOnWarning: false
jobs:
  - type: openapi
    parameters:
      apiFile: ${spec}
      targetUrl: ${targetUrl}
EOF`;

  try {
    const result = await withTimeout(
      execCommandAsync(cmd, { cwd: root, timeout: timeoutMs }),
      timeoutMs,
      gateTimeoutMessage('zap api dast', timeoutMs),
    );
    if (!result.success) {
      return formatResult('zap-api-dast', DECISION.DENY, 'ZAP API DAST 发现安全问题或执行失败', {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }
    return formatResult('zap-api-dast', DECISION.ALLOW, 'ZAP API baseline 通过');
  } catch (e) {
    return denyOnToolError(e, 'zap-api-dast', 'zap');
  }
}
