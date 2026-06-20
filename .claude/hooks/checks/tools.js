import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';

/** @type {Record<string, string>} */
export const TOOL_INSTALL_HINTS = {
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
};

/** @param {string} tool */
export function getToolInstallHint(tool) {
  return TOOL_INSTALL_HINTS[tool] || `请先安装 ${tool}`;
}

/** @param {string} tool @param {string} [cwd] */
export function isToolInstalled(tool, cwd) {
  const env = { ...process.env };
  return execCommand(`command -v ${tool}`, { cwd, env }).success;
}

/** @param {string} [cwd] */
export function getRuffInvocation(cwd) {
  if (execCommand('test -f pyproject.toml', { cwd }).success && isToolInstalled('uv', cwd)) {
    return 'uv run ruff';
  }
  return 'ruff';
}

/**
 * @param {string} checkId
 * @param {string} [cwd]
 * @returns {import('../security-orchestrator.js').CheckResult | null}
 */
export function denyIfRuffMissing(checkId, cwd) {
  if (execCommand('test -f pyproject.toml', { cwd }).success && isToolInstalled('uv', cwd)) {
    return null;
  }
  return denyIfToolMissing('ruff', checkId, cwd);
}

/**
 * @param {string} tool
 * @param {string} checkId
 * @param {string} [cwd]
 * @returns {import('../security-orchestrator.js').CheckResult | null}
 */
export function denyIfToolMissing(tool, checkId, cwd) {
  if (!isToolInstalled(tool, cwd)) {
    const hint = getToolInstallHint(tool);
    return formatResult(checkId, DECISION.DENY, `${tool} 未安装。请执行: ${hint}`, { installHint: hint });
  }
  return null;
}

/** @param {string} [cwd] */
export function isPyrightAvailable(cwd) {
  return isToolInstalled('pyright', cwd) || isToolInstalled('uv', cwd);
}

/** @param {string} checkId @param {string} [cwd] @returns {import('../security-orchestrator.js').CheckResult | null} */
export function denyIfPyrightMissing(checkId, cwd) {
  if (!isPyrightAvailable(cwd)) {
    const hint = `${getToolInstallHint('pyright')}；或 ${getToolInstallHint('uv')}`;
    return formatResult(checkId, DECISION.DENY, `pyright 未安装（需 pyright 或 uv）。请执行: ${hint}`, {
      installHint: hint,
    });
  }
  return null;
}

/**
 * @param {unknown} error
 * @param {string} checkId
 * @param {string} tool
 * @returns {import('../security-orchestrator.js').CheckResult}
 */
export function denyOnToolError(error, checkId, tool) {
  const message = error instanceof Error ? error.message : String(error);
  return formatResult(checkId, DECISION.DENY, `${tool} 执行失败: ${message}`);
}
