import { createHash } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import { gateTimeoutMessage } from '../gate-timeouts.js';
import { resolveScanTargets, getScanScope } from './scan-scope.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const SBOM_DIR = '.hooks/sbom';
const SBOM_TIMEOUT_MS = 5 * 60 * 1000;

function getCommitSha(cwd: string): string {
  const result = execCommand('git rev-parse HEAD', { cwd, timeout: 5000 });
  return result.success && result.stdout.trim() ? result.stdout.trim().slice(0, 12) : 'unknown';
}

export async function runSbomArchive(cwd?: string, options?: GateCheckRunOptions): Promise<CheckResult> {
  const root = cwd ?? process.cwd();
  const timeoutMs = options?.timeoutMs ?? SBOM_TIMEOUT_MS;

  const hasSyft = execCommand('command -v syft', { cwd: root }).success;
  const hasTrivy = execCommand('command -v trivy', { cwd: root }).success;
  if (!hasSyft && !hasTrivy) {
    const missing = denyIfToolMissing('syft', 'sbom-archive', root);
    return missing ?? formatResult('sbom-archive', DECISION.DENY, 'syft 或 trivy 未安装');
  }

  const sha = getCommitSha(root);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- root 为受信仓库根，第二参为常量 SBOM_DIR
  const outDir = join(root, SBOM_DIR);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- outDir 派生自受信 root 与常量目录
  const outFile = join(outDir, `sbom-${sha}.cyclonedx.json`);

  const scanTarget = resolveScanTargets(getScanScope(root));
  const cmd = hasSyft
    ? `syft ${scanTarget} -o cyclonedx-json=${outFile}`
    : `trivy fs --format cyclonedx --output ${outFile} ${scanTarget}`;

  try {
    const result = await withTimeout(
      execCommandAsync(cmd, { cwd: root, timeout: timeoutMs }),
      timeoutMs,
      gateTimeoutMessage('sbom archive', timeoutMs),
    );
    if (!result.success) {
      return formatResult('sbom-archive', DECISION.DENY, 'SBOM 生成失败', {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }
    if (!existsSync(outFile)) {
      return formatResult('sbom-archive', DECISION.DENY, 'SBOM 输出文件未生成');
    }
    const raw = readFileSync(outFile, 'utf-8');
    writeFileSync(join(outDir, 'latest.json'), raw, 'utf-8'); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- outDir 派生自受信 root
    const digest = createHash('sha256').update(raw).digest('hex');
    const outBase = outFile.split('/').pop() ?? 'sbom.json';
    writeFileSync(`${outFile}.sha256`, `${digest}  ${outBase}\n`, 'utf-8'); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- outFile 派生自受信 root
    appendFileSync(
      join(outDir, 'index.jsonl'), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- outDir 派生自受信 root
      JSON.stringify({ ts: new Date().toISOString(), sha, path: outFile, sha256: digest }) + '\n',
      'utf-8',
    );
    return formatResult('sbom-archive', DECISION.ALLOW, `SBOM 已归档: ${SBOM_DIR}/sbom-${sha}.cyclonedx.json`, {
      path: outFile,
      sha,
      sha256: digest,
    });
  } catch (e) {
    return denyOnToolError(e, 'sbom-archive', 'sbom');
  }
}
