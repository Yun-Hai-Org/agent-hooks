import { formatResult, DECISION } from '../security-orchestrator.js';
import { getToolInstallHint, isToolInstalled } from './tools.js';
import type { CheckResult } from '../types.js';

export type ContainerRuntimeName = 'podman' | 'docker';

export interface ContainerRuntime {
  name: ContainerRuntimeName;
  binary: string;
}

const RUNTIME_PRIORITY: ContainerRuntimeName[] = ['podman', 'docker'];

export function resolveContainerRuntime(cwd?: string): ContainerRuntime | null {
  for (const name of RUNTIME_PRIORITY) {
    if (isToolInstalled(name, cwd)) {
      return { name, binary: name };
    }
  }
  return null;
}

export function getComposeConfigCmd(file: string, cwd?: string): string | null {
  const runtime = resolveContainerRuntime(cwd);
  if (!runtime) return null;
  return `${runtime.binary} compose -f "${file}" config --quiet`;
}

export function getContainerRuntimeInstallHint(): string {
  return `${getToolInstallHint('podman')}；或 ${getToolInstallHint('docker')}`;
}

export function denyIfContainerRuntimeMissing(checkId: string, cwd?: string): CheckResult | null {
  if (resolveContainerRuntime(cwd)) return null;
  const hint = getContainerRuntimeInstallHint();
  return formatResult(checkId, DECISION.DENY, `容器运行时未安装（需 podman 或 docker）。请执行: ${hint}`, {
    installHint: hint,
  });
}
