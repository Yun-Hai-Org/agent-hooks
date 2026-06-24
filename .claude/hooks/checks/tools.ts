import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';
import type { CheckResult } from '../types.js';

export const TOOL_INSTALL_HINTS: Record<string, string> = {
  bun: 'curl -fsSL https://bun.sh/install | bash',
  uv: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  ruff: 'uv tool install ruff  # 或 pip install ruff',
  pyright: 'uv tool install pyright  # 或 npm i -g pyright',
  pytest: 'uv add --dev pytest',
  semgrep: 'uv tool install semgrep  # 或 pip install semgrep',
  gitleaks: 'brew install gitleaks  # 或见 https://github.com/gitleaks/gitleaks#installing',
  trivy: 'brew install trivy  # 或见 https://aquasecurity.github.io/trivy/latest/getting-started/installation/',
  eslint: 'bun add -d eslint',
  prettier: 'bun add -d prettier',
  shellcheck: 'brew install shellcheck',
  shfmt: 'brew install shfmt',
  hadolint: 'brew install hadolint  # 或见 https://github.com/hadolint/hadolint#installing',
  docker: 'brew install --cask docker  # 或见 https://docs.docker.com/get-docker/',
  kubeconform: 'brew install kubeconform',
  'kube-linter': 'brew install kube-linter',
  taplo: 'brew install taplo',
  sqlfluff: 'uv tool install sqlfluff',
  'check-jsonschema': 'uv tool install check-jsonschema',
  jq: 'brew install jq',
  yq: 'brew install yq',
  markdownlint: 'bun add -d markdownlint-cli2',
  oasdiff: 'brew install oasdiff  # 或 go install github.com/oasdiff/oasdiff@latest',
  'osv-scanner': 'brew install osv-scanner  # 或 go install github.com/google/osv-scanner/cmd/osv-scanner@latest',
  'pip-audit': 'uv tool install pip-audit  # 或 pip install pip-audit',
};

export function getToolInstallHint(tool: string): string {
  return TOOL_INSTALL_HINTS[tool] ?? `请先安装 ${tool}`;
}

export function isToolInstalled(tool: string, cwd?: string): boolean {
  const env = { ...process.env };
  return execCommand(`command -v ${tool}`, { cwd, env }).success;
}

export function getRuffInvocation(cwd?: string): string {
  if (execCommand('test -f pyproject.toml', { cwd }).success && isToolInstalled('uv', cwd)) {
    return 'uv run ruff';
  }
  return 'ruff';
}

export function denyIfRuffMissing(checkId: string, cwd?: string): CheckResult | null {
  if (execCommand('test -f pyproject.toml', { cwd }).success && isToolInstalled('uv', cwd)) {
    return null;
  }
  return denyIfToolMissing('ruff', checkId, cwd);
}

export function denyIfToolMissing(tool: string, checkId: string, cwd?: string): CheckResult | null {
  if (!isToolInstalled(tool, cwd)) {
    const hint = getToolInstallHint(tool);
    return formatResult(checkId, DECISION.DENY, `${tool} 未安装。请执行: ${hint}`, { installHint: hint });
  }
  return null;
}

export function isPyrightAvailable(cwd?: string): boolean {
  return isToolInstalled('pyright', cwd) || isToolInstalled('uv', cwd);
}

export function denyIfPyrightMissing(checkId: string, cwd?: string): CheckResult | null {
  if (!isPyrightAvailable(cwd)) {
    const hint = `${getToolInstallHint('pyright')}；或 ${getToolInstallHint('uv')}`;
    return formatResult(checkId, DECISION.DENY, `pyright 未安装（需 pyright 或 uv）。请执行: ${hint}`, {
      installHint: hint,
    });
  }
  return null;
}

export function denyOnToolError(error: unknown, checkId: string, tool: string): CheckResult {
  const message = error instanceof Error ? error.message : String(error);
  return formatResult(checkId, DECISION.DENY, `${tool} 执行失败: ${message}`);
}
