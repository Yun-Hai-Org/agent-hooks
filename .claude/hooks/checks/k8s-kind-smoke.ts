import { existsSync } from 'fs';
import { join } from 'path';
import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { isDockerfilePath, isK8sManifestPath, listTrackedFiles } from './file-patterns.js';
import { resolveContainerRuntime } from './container-runtime.js';
import { isToolInstalled } from './tools.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const KIND_SMOKE_SCRIPT = 'scripts/kind-smoke.sh';
const KIND_SMOKE_TIMEOUT_MS = 300000;

export function hasKindSmokeOptIn(cwd?: string): boolean {
  const root = cwd ?? process.cwd();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- root 为受信仓库根，第二参为常量 opt-in 标记路径
  if (existsSync(join(root, KIND_SMOKE_SCRIPT))) return true;
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- root 为受信仓库根，第二参为常量
  if (existsSync(join(root, 'kind-config.yaml'))) return true;
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- root 为受信仓库根，第二参为常量
  if (existsSync(join(root, '.kind', 'config'))) return true;
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- root 为受信仓库根，第二参为常量
  if (existsSync(join(root, '.hooks', 'kind-smoke'))) return true;
  return false;
}

export function hasContainerfileInRepo(cwd?: string): boolean {
  const files = listTrackedFiles((f) => isDockerfilePath(f), cwd);
  return files.length > 0;
}

export function hasK8sManifestsInRepo(cwd?: string): boolean {
  const files = listTrackedFiles((f) => {
    if (f.startsWith('_bmad-output/') || f.startsWith('_bmad/')) return false;
    return isK8sManifestPath(f, cwd);
  }, cwd);
  return files.length > 0;
}

export function getKindSmokeScriptPath(cwd?: string): string {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，第二参为常量脚本路径
  return join(cwd ?? process.cwd(), KIND_SMOKE_SCRIPT);
}

export async function runK8sKindSmokeFull(cwd?: string, _options?: GateCheckRunOptions): Promise<CheckResult> {
  const checkId = 'k8s-kind-smoke';

  if (!hasKindSmokeOptIn(cwd)) {
    return formatResult(checkId, DECISION.SKIP, '未启用 Kind smoke，跳过');
  }

  if (!hasK8sManifestsInRepo(cwd)) {
    return formatResult(checkId, DECISION.SKIP, '无 K8s manifest，跳过 Kind smoke');
  }

  if (!hasContainerfileInRepo(cwd)) {
    return formatResult(checkId, DECISION.SKIP, '无 Dockerfile/Containerfile，跳过 Kind smoke');
  }

  if (!resolveContainerRuntime(cwd)) {
    return formatResult(checkId, DECISION.SKIP, 'Kind smoke 已启用但缺少 podman/docker，跳过');
  }

  if (!isToolInstalled('kind', cwd) || !isToolInstalled('kubectl', cwd)) {
    return formatResult(checkId, DECISION.SKIP, 'Kind smoke 已启用但缺少 kind/kubectl，跳过');
  }

  const scriptPath = getKindSmokeScriptPath(cwd);
  if (!existsSync(scriptPath)) {
    return formatResult(checkId, DECISION.SKIP, `未找到 ${KIND_SMOKE_SCRIPT}，跳过 Kind smoke`);
  }

  const scriptCheck = execCommand(`test -x "${scriptPath}"`, { cwd });
  if (!scriptCheck.success) {
    return formatResult(checkId, DECISION.DENY, `${KIND_SMOKE_SCRIPT} 不可执行，请 chmod +x`, {
      output: scriptPath,
    });
  }

  try {
    const result = await withTimeout(
      execCommandAsync(`"${scriptPath}"`, { cwd, timeout: KIND_SMOKE_TIMEOUT_MS }),
      KIND_SMOKE_TIMEOUT_MS,
      `Kind smoke 超时 (${String(KIND_SMOKE_TIMEOUT_MS / 1000)}s)`,
    );
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    if (!result.success) {
      return formatResult(checkId, DECISION.DENY, 'Kind smoke 检查失败', {
        output: output.slice(0, 500),
      });
    }
    return formatResult(checkId, DECISION.ALLOW, 'Kind smoke 检查通过');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return formatResult(checkId, DECISION.DENY, `Kind smoke 执行失败: ${message}`);
  }
}
