/** 质量门节点注册表（SSOT）：清单、默认超时、example 生成 */

export const REGISTRY_COMMIT_TIMEOUT_MS = 5 * 60 * 1000;
export const REGISTRY_FULL_TIMEOUT_MS = 15 * 60 * 1000;

export interface GateLeafNode {
  description: string;
  defaultTimeoutMs?: number;
  supportsAutoFix?: boolean;
  controlIds?: string[];
}

export interface GateHookNode extends GateLeafNode {
  checks?: Record<string, GateLeafNode>;
  rules?: Record<string, GateLeafNode>;
}

export interface GateRegistryRoot {
  ide: Record<string, GateHookNode>;
  git: Record<string, GateHookNode>;
}

interface LeafOptions {
  defaultTimeoutMs?: number;
  supportsAutoFix?: boolean;
  controlIds?: string[];
}

function leaf(description: string, options: LeafOptions = {}): GateLeafNode {
  const node: GateLeafNode = { description };
  if (options.defaultTimeoutMs !== undefined) node.defaultTimeoutMs = options.defaultTimeoutMs;
  if (options.supportsAutoFix) node.supportsAutoFix = true;
  if (options.controlIds !== undefined) node.controlIds = options.controlIds;
  return node;
}

/** 可 auto-fix 的 git/IDE check id 后缀（SSOT） */
export const AUTO_FIXABLE_CHECK_IDS = new Set([
  'prettier',
  'markdownlint',
  'ruff',
  'shfmt',
  'taplo',
  'lint-staged-eslint',
  'lint-eslint',
  'lint-staged-ruff',
  'lint-ruff',
  'lint-staged-markdownlint',
  'lint-markdownlint',
  'lint-staged-stylelint',
  'lint-stylelint',
  'format-staged-prettier',
  'format-prettier',
  'format-staged-ruff',
  'format-ruff',
  'format-staged-shfmt',
  'format-shfmt',
  'format-staged-taplo',
  'format-taplo',
  'lint-staged-sqlfluff',
  'lint-sqlfluff',
]);

function checksFrom(
  ids: Record<string, string>,
  defaultTimeoutMs?: number,
  overrides?: Record<string, LeafOptions>,
): Record<string, GateLeafNode> {
  const out: Record<string, GateLeafNode> = {};
  for (const [id, description] of Object.entries(ids)) {
    const extra = overrides?.[id];
    const opts: LeafOptions = {};
    const timeout = extra?.defaultTimeoutMs ?? defaultTimeoutMs;
    if (timeout !== undefined) opts.defaultTimeoutMs = timeout;
    if (extra?.supportsAutoFix ?? AUTO_FIXABLE_CHECK_IDS.has(id)) opts.supportsAutoFix = true;
    if (extra?.controlIds !== undefined) opts.controlIds = extra.controlIds;
    out[id] = leaf(description, opts);
  }
  return out;
}

/** block-dangerous-commands PATTERNS + merge 专项规则 id（与 block-dangerous-commands.ts 同步） */
export const BLOCK_DANGEROUS_RULE_IDS = [
  'rm-home',
  'rm-home-var',
  'rm-home-trailing',
  'rm-root',
  'rm-system',
  'rm-cwd',
  'dd-disk',
  'mkfs',
  'fork-bomb',
  'curl-pipe-sh',
  'base64-pipe-sh',
  'eval-exec',
  'sh-c-subshell',
  'download-exec',
  'reverse-shell-devtcp',
  'reverse-shell-netcat',
  'git-force-main',
  'git-reset-hard',
  'git-clean-f',
  'chmod-777',
  'chmod-setuid',
  'cat-env',
  'cat-secrets',
  'env-dump',
  'echo-secret',
  'docker-vol-rm',
  'podman-vol-rm',
  'rm-ssh',
  'git-force-lease-main',
  'kubectl-get-secret',
  'kubectl-describe-secret',
  'docker-exec-env',
  'podman-exec-env',
  'pip-install',
  'npm-install',
  'npm-ci',
  'pnpm-install',
  'yarn-install',
  'npx',
  'python-script',
  'python3-script',
  'node-script',
  'hook-bypass-path',
  'hook-bypass-config',
  'no-verify',
  'no-verify-short',
  'push-no-verify',
  'merge-no-verify',
  'gh-pr-merge',
  'git-pull-merge',
  'git-update-ref-delete',
  'git-force-any',
  'git-checkout-dot',
  'sudo-rm',
  'docker-prune',
  'podman-prune',
  'crontab-r',
  'merge-ff-bypass',
  'merge-squash-bypass',
  'merge-conclude-bypass',
  'protected-branch-delete',
] as const;

const BLOCK_DANGEROUS_RULE_DESCRIPTIONS: Record<string, string> = {
  'rm-home': '拦截 rm 删除 home 目录',
  'rm-home-var': '拦截 rm 删除 $HOME',
  'rm-home-trailing': '拦截 rm 尾随 ~/ 或 $HOME 路径',
  'rm-root': '拦截 rm 删除根文件系统',
  'rm-system': '拦截 rm 删除 /etc /usr 等系统目录',
  'rm-cwd': '拦截 rm 删除当前目录内容',
  'dd-disk': '拦截 dd 写入磁盘设备',
  mkfs: '拦截 mkfs 格式化磁盘',
  'fork-bomb': '拦截 fork bomb 模式',
  'curl-pipe-sh': '拦截 curl|bash 远程执行',
  'base64-pipe-sh': '拦截 base64 解码后 pipe shell',
  'eval-exec': '拦截 eval/exec 动态执行',
  'sh-c-subshell': '拦截 sh -c 子 shell 危险用法',
  'download-exec': '拦截下载后立即执行',
  'reverse-shell-devtcp': '拦截 /dev/tcp 反弹 shell',
  'reverse-shell-netcat': '拦截 nc 反弹 shell',
  'git-force-main': '拦截对 main 的 force push',
  'git-reset-hard': '拦截 git reset --hard',
  'git-clean-f': '拦截 git clean -f 强制清理',
  'chmod-777': '拦截 chmod 777',
  'chmod-setuid': '拦截 chmod setuid/setgid',
  'cat-env': '拦截 cat .env 泄露密钥',
  'cat-secrets': '拦截 cat 敏感文件',
  'env-dump': '拦截 env/printenv 导出环境变量',
  'echo-secret': '拦截 echo 输出密钥变量',
  'docker-vol-rm': '拦截 docker volume rm',
  'podman-vol-rm': '拦截 podman volume rm',
  'rm-ssh': '拦截删除 ~/.ssh',
  'git-force-lease-main': '拦截对 main 的 force-with-lease',
  'kubectl-get-secret': '拦截 kubectl get secret',
  'kubectl-describe-secret': '拦截 kubectl describe secret',
  'docker-exec-env': '拦截 docker exec 带 -e 传环境变量',
  'podman-exec-env': '拦截 podman exec 带 -e 传环境变量',
  'pip-install': '拦截 pip install，请用 uv',
  'npm-install': '拦截 npm install，请用 bun',
  'npm-ci': '拦截 npm ci，请用 bun install --frozen-lockfile',
  'pnpm-install': '拦截 pnpm install，请用 bun',
  'yarn-install': '拦截 yarn install，请用 bun',
  npx: '拦截 npx，请用 bunx',
  'python-script': '拦截 python script.py，请用 uv run',
  'python3-script': '拦截 python3 script.py，请用 uv run',
  'node-script': '拦截 node script.js，请用 bun',
  'hook-bypass-path': '拦截修改 hooks 路径绕过',
  'hook-bypass-config': '拦截修改 core.hooksPath 绕过',
  'no-verify': '拦截 git commit --no-verify',
  'no-verify-short': '拦截 git commit -n 绕过 hook',
  'push-no-verify': '拦截 git push --no-verify',
  'merge-no-verify': '拦截 git merge --no-verify',
  'gh-pr-merge': '拦截 gh pr merge 绕过本地门',
  'git-pull-merge': '拦截 git pull 产生 merge commit 绕过',
  'git-update-ref-delete': '拦截 git update-ref -d 删分支',
  'git-force-any': '拦截 git push --force 到任意分支',
  'git-checkout-dot': '拦截 git checkout . 丢弃工作区',
  'sudo-rm': '拦截 sudo rm',
  'docker-prune': '拦截 docker system/volume prune',
  'podman-prune': '拦截 podman system/volume prune',
  'crontab-r': '拦截 crontab -r 删除全部 cron',
  'merge-ff-bypass': 'main/master 上拦截无 --no-ff 的 merge',
  'merge-squash-bypass': 'main/master 上拦截 squash merge 绕过 pre-merge-commit',
  'merge-conclude-bypass': '拦截 merge --continue 绕过 full 门',
  'protected-branch-delete': '拦截删除 main/master 等保护分支',
};

const SESSION_START_TOOLS = [
  'bun',
  'uv',
  'gitleaks',
  'shellcheck',
  'shfmt',
  'hadolint',
  'container-runtime',
  'kubeconform',
  'kube-linter',
  'oasdiff',
  'taplo',
  'sqlfluff',
  'stylelint',
  'prettier',
  'eslint',
  'ruff',
  'pyright',
  'markdownlint',
  'jq',
  'yq',
  'check-jsonschema',
  'semgrep',
  'trivy',
  'osv-scanner',
  'pip-audit',
  'knip',
  'syft',
  'zap',
  'conftest',
  'cosign',
  'checkov',
] as const;

const SESSION_TOOL_DESCRIPTIONS: Record<string, string> = {
  bun: '检测 Bun 运行时是否可用',
  uv: '检测 uv Python 工具链是否可用',
  gitleaks: '检测 gitleaks 密钥扫描是否可用',
  shellcheck: '检测 shellcheck 是否可用',
  shfmt: '检测 shfmt 是否可用',
  hadolint: '检测 hadolint 是否可用',
  'container-runtime': '检测 podman/docker 是否可用',
  kubeconform: '检测 kubeconform 是否可用',
  'kube-linter': '检测 kube-linter 是否可用',
  oasdiff: '检测 oasdiff OpenAPI diff 是否可用',
  taplo: '检测 taplo TOML 工具是否可用',
  sqlfluff: '检测 sqlfluff 是否可用',
  stylelint: '检测 stylelint 是否可用',
  prettier: '检测 prettier 是否可用',
  eslint: '检测 eslint 是否可用',
  ruff: '检测 ruff 是否可用',
  pyright: '检测 pyright 是否可用',
  markdownlint: '检测 markdownlint 是否可用',
  jq: '检测 jq 是否可用',
  yq: '检测 yq 是否可用',
  'check-jsonschema': '检测 check-jsonschema 是否可用',
  semgrep: '检测 semgrep 是否可用',
  trivy: '检测 trivy 是否可用',
  'osv-scanner': '检测 osv-scanner 是否可用',
  'pip-audit': '检测 pip-audit 是否可用',
  knip: '检测 knip 是否可用',
  syft: '检测 syft SBOM 工具是否可用',
  zap: '检测 OWASP ZAP 是否可用',
  conftest: '检测 conftest OPA 策略工具是否可用',
  cosign: '检测 cosign 签名验证工具是否可用',
  checkov: '检测 checkov IaC 扫描是否可用',
};

const PRE_COMMIT_CHECKS: Record<string, string> = {
  'branch-check': '禁止在 main/master 等功能分支策略不允许的分支上提交',
  'sensitive-files': '暂存区不得包含 .env、密钥等敏感文件',
  'dep-audit': '暂存区依赖文件变更时 bun audit 审计',
  'type-check': '暂存区 TS/Python 类型检查（tsc/pyright）',
  'related-tests': '运行与暂存文件关联的 pytest/bun 测试',
  'lint-staged': '暂存区 lint 聚合门',
  'lint-staged-eslint': '暂存区 ESLint（JS/TS，不含 __tests__）',
  'lint-staged-ruff': '暂存区 Ruff lint（Python）',
  'format-staged': '暂存区 format 聚合门',
  'format-staged-prettier': '暂存区 Prettier format check',
  'format-staged-ruff': '暂存区 Ruff format check',
  'gitleaks-staged': '暂存区 gitleaks diff 密钥扫描',
  'semgrep-staged': '暂存区 Semgrep 安全扫描',
  'code-review-staged': '暂存区 AI code review（若配置）',
  'hook-adversarial': 'hooks 变更时运行对抗性测试',
  'extended-staged': '暂存区扩展 lint 聚合门',
  'extended-staged-extended': '暂存区扩展 lint 汇总结果',
  'lint-staged-markdownlint': '暂存区 markdownlint',
  'format-staged-shfmt': '暂存区 shfmt 格式检查',
  'lint-staged-shellcheck': '暂存区 shellcheck',
  'lint-staged-hadolint': '暂存区 hadolint Dockerfile 检查',
  'lint-staged-compose': '暂存区 docker/podman compose 配置检查',
  'format-staged-taplo': '暂存区 taplo TOML 格式检查',
  'lint-staged-sqlfluff': '暂存区 sqlfluff SQL lint',
  'lint-staged-stylelint': '暂存区 stylelint CSS 检查',
  'schema-staged': '暂存区 JSON/YAML schema 聚合门',
  'schema-staged-schema': '暂存区 schema 检查汇总',
  'schema-staged-check-jsonschema': '暂存区 check-jsonschema 验证',
  'schema-staged-jq': '暂存区 jq JSON 语法校验',
  'schema-staged-yq': '暂存区 yq YAML 语法校验',
  'k8s-staged': '暂存区 K8s manifest 聚合门',
  'k8s-staged-kubeconform': '暂存区 kubeconform 校验',
  'k8s-staged-kube-linter': '暂存区 kube-linter 校验',
  'openapi-staged': '暂存区 OpenAPI 契约聚合门',
  'openapi-staged-oasdiff': '暂存区 oasdiff breaking change 检测',
  'lockfile-freshness': '暂存区 lockfile 与 manifest 一致性',
  'semgrep-pci-staged': '暂存区 Semgrep PCI/OWASP 金融规则包',
  'payment-page-staged': '暂存区支付页脚本授权/SRI/CSP 检查',
};

const FULL_CHECKS: Record<string, string> = {
  'hook-unit-tests': 'Hook 项目 bun test --coverage 全量单测',
  coverage: '覆盖率检查（已并入 hook-unit-tests，占位 SKIP）',
  'type-check': '全仓 TS/Python 类型检查',
  'lint-full': '全仓 lint 聚合门',
  'lint-eslint': '全仓 ESLint',
  'lint-ruff': '全仓 Ruff lint',
  'full-tests': '全仓测试聚合门',
  'full-test-py': '全仓 pytest',
  'full-test-js': '全仓 bun 项目级测试',
  'hook-adversarial': 'Hook 对抗性测试全量运行',
  'dep-audit': '全仓 JS 依赖 bun audit',
  'py-dep-audit': 'Python 依赖 osv-scanner/pip-audit',
  gitleaks: '全仓 gitleaks 扫描',
  semgrep: '全仓 Semgrep 安全扫描',
  knip: '全仓 knip 死代码检测',
  trivy: '全仓 Trivy 漏洞/配置扫描',
  'format-full': '全仓 format 聚合门',
  'format-prettier': '全仓 Prettier format check',
  'format-ruff': '全仓 Ruff format check',
  'code-review': '全仓 AI code review',
  'extended-full': '全仓扩展 lint 聚合门',
  'extended-full-extended': '全仓扩展 lint 汇总结果',
  'lint-markdownlint': '全仓 markdownlint',
  'format-shfmt': '全仓 shfmt 格式检查',
  'lint-shellcheck': '全仓 shellcheck',
  'lint-hadolint': '全仓 hadolint',
  'lint-compose': '全仓 compose 配置检查',
  'format-taplo': '全仓 taplo 格式检查',
  'lint-sqlfluff': '全仓 sqlfluff',
  'lint-stylelint': '全仓 stylelint',
  'schema-full': '全仓 JSON/YAML schema 聚合门',
  'schema-full-schema': '全仓 schema 检查汇总',
  'schema-full-check-jsonschema': '全仓 check-jsonschema 验证',
  'schema-full-jq': '全仓 jq JSON 语法校验',
  'schema-full-yq': '全仓 yq YAML 语法校验',
  'k8s-full': '全仓 K8s manifest 聚合门',
  'k8s-full-kubeconform': '全仓 kubeconform 校验',
  'k8s-full-kube-linter': '全仓 kube-linter 校验',
  'k8s-kind-smoke': 'Kind 集群 smoke 测试（若脚本存在）',
  'openapi-full': '全仓 OpenAPI 契约聚合门',
  'openapi-full-oasdiff': '全仓 oasdiff 检查',
  'lockfile-freshness': '全仓 lockfile 新鲜度校验',
  'sbom-archive': 'CycloneDX SBOM 生成与不可变归档',
  'semgrep-pci': '全仓 Semgrep PCI/OWASP 金融规则',
  'payment-page-full': '全仓支付页脚本/SRI 检查',
  'zap-api-dast': 'OWASP ZAP API baseline（OpenAPI 驱动）',
  'opa-conftest': 'Conftest/OPA 策略（PCI-DORA Rego）',
  'iac-checkov': 'Checkov IaC 扫描（Terraform/K8s/Dockerfile）',
  'slsa-cosign': 'SLSA/Cosign 制品 provenance 校验',
};

function buildBlockDangerousRules(): Record<string, GateLeafNode> {
  const rules: Record<string, GateLeafNode> = {};
  for (const id of BLOCK_DANGEROUS_RULE_IDS) {
    rules[id] = leaf(BLOCK_DANGEROUS_RULE_DESCRIPTIONS[id] ?? `拦截危险命令规则 ${id}`);
  }
  return rules;
}

function buildSessionStartChecks(): Record<string, GateLeafNode> {
  const checks: Record<string, GateLeafNode> = {};
  for (const name of SESSION_START_TOOLS) {
    checks[name] = leaf(SESSION_TOOL_DESCRIPTIONS[name] ?? `检测 ${name} CLI 是否可用`, { defaultTimeoutMs: 500 });
  }
  return checks;
}

function buildFullHookChecks(): Record<string, GateLeafNode> {
  const fintechOverrides: Record<string, LeafOptions> = {
    'dep-audit': { controlIds: ['PCI-6.3.2', 'PCI-6.3.3'] },
    'py-dep-audit': { controlIds: ['PCI-6.3.2', 'PCI-6.3.3'] },
    gitleaks: { controlIds: ['PCI-6.3.3', 'SOX-404'] },
    semgrep: { controlIds: ['PCI-6.3.3', 'PCI-6.5'] },
    trivy: { controlIds: ['PCI-6.3.2', 'PCI-6.3.3'] },
    'sbom-archive': { defaultTimeoutMs: 5 * 60 * 1000, controlIds: ['PCI-6.3.2', 'DORA-Art6'] },
    'semgrep-pci': { controlIds: ['PCI-6.3.3'] },
    'payment-page-full': { defaultTimeoutMs: 3 * 60 * 1000, controlIds: ['PCI-6.4.3', 'PCI-11.6.1'] },
    'zap-api-dast': { defaultTimeoutMs: 10 * 60 * 1000, controlIds: ['PCI-11.3'] },
    'opa-conftest': { defaultTimeoutMs: 3 * 60 * 1000, controlIds: ['DORA-Art6', 'SOX-404'] },
    'iac-checkov': { defaultTimeoutMs: 5 * 60 * 1000, controlIds: ['PCI-6.3.3'] },
    'slsa-cosign': { defaultTimeoutMs: 2 * 60 * 1000, controlIds: ['PCI-6.3.2', 'SLSA-L3'] },
  };
  const checks = checksFrom(FULL_CHECKS, undefined, fintechOverrides);
  checks['hook-unit-tests'] = leaf(FULL_CHECKS['hook-unit-tests'] ?? '', { defaultTimeoutMs: 12 * 60 * 1000 });
  return checks;
}

function buildPreCommitChecks(): Record<string, GateLeafNode> {
  const fintechOverrides: Record<string, LeafOptions> = {
    'sensitive-files': { controlIds: ['PIPL-Min', 'SOX-404'] },
    'dep-audit': { controlIds: ['PCI-6.3.2', 'PCI-6.3.3'] },
    'gitleaks-staged': { controlIds: ['PCI-6.3.3', 'SOX-404'] },
    'semgrep-staged': { controlIds: ['PCI-6.3.3', 'PCI-6.5'] },
    'semgrep-pci-staged': { controlIds: ['PCI-6.3.3', 'PCI-6.5'] },
    'payment-page-staged': { controlIds: ['PCI-6.4.3'] },
  };
  return checksFrom(PRE_COMMIT_CHECKS, undefined, fintechOverrides);
}

export const GATE_REGISTRY: GateRegistryRoot = {
  ide: {
    'block-dangerous-commands': {
      description: 'beforeShellExecution：拦截灾难性/高风险 shell 命令与 hook 绕过',
      rules: buildBlockDangerousRules(),
    },
    'branch-gate': {
      description: 'preToolUse：非 Git 仓库或功能分支策略下的分支操作门控',
    },
    'branch-delete-gate': {
      description: 'beforeShellExecution：限制删除未 merge 分支与 worktree prune',
      checks: checksFrom({
        'protected-branch-delete': '拦截删除 main/master 等保护分支',
        'unmerged-branch-delete': '拦截删除未 merge 进基准分支的本地/远程分支',
        'worktree-prune': '拦截 git worktree prune',
      }),
    },
    'protect-secrets': {
      description: 'preToolUse/beforeReadFile：阻止读写/外传敏感文件与 embedded secrets',
      checks: checksFrom({
        'file-path': 'Read/Write/Edit 路径匹配敏感文件模式',
        content: 'Write/Edit 内容扫描 embedded secrets',
        'bash-command': 'Bash 命令外传/读取敏感数据模式',
      }),
    },
    'user-prompt-filter': {
      description: 'beforeSubmitPrompt：过滤用户 prompt 中的敏感/违规内容',
    },
    'session-start': {
      description: 'SessionStart：检测 hook 依赖 CLI 工具可用性（fail-open）',
      defaultTimeoutMs: 2000,
      checks: buildSessionStartChecks(),
    },
    'format-on-write': {
      description: 'afterFileEdit：写后自动 format（prettier/ruff 等）',
      defaultTimeoutMs: 30_000,
      supportsAutoFix: true,
      checks: checksFrom(
        {
          prettier: '对 JS/TS/JSON/Markdown/CSS 等执行 prettier --write',
          markdownlint: '对 .md/.mdx 执行 markdownlint-cli2 --fix',
          ruff: '对 .py 执行 ruff format（需 pyproject.toml）',
          shfmt: '对 shell 脚本执行 shfmt -w',
          taplo: '对 .toml 执行 taplo format',
        },
        undefined,
        {
          prettier: { supportsAutoFix: true },
          markdownlint: { supportsAutoFix: true },
          ruff: { supportsAutoFix: true },
          shfmt: { supportsAutoFix: true },
          taplo: { supportsAutoFix: true },
        },
      ),
    },
    'auto-stage': {
      description: 'afterFileEdit：Agent 编辑后自动 git add 相关文件',
    },
    'auto-commit': {
      description: 'Stop：会话结束前提示/执行 git commit',
    },
    'gate-retry-stop': {
      description: 'Stop：质量门失败后阻止 Agent 无限重试',
      defaultTimeoutMs: 120_000,
    },
    notification: {
      description: 'Notification：安全/质量事件 webhook 通知',
      defaultTimeoutMs: 5000,
    },
  },
  git: {
    'commit-msg': {
      description: 'commit-msg 钩子：校验 commit message 格式与语义',
      checks: checksFrom({
        'commit-msg': 'Conventional commit 类型前缀与描述非空/非笼统',
      }),
    },
    'pre-commit': {
      description: 'pre-commit 钩子：暂存区 commit profile 质量门（单项默认 5 分钟）',
      defaultTimeoutMs: REGISTRY_COMMIT_TIMEOUT_MS,
      supportsAutoFix: true,
      checks: buildPreCommitChecks(),
    },
    'pre-push': {
      description: 'pre-push 钩子：full profile 质量门（总项默认 15 分钟）',
      defaultTimeoutMs: REGISTRY_FULL_TIMEOUT_MS,
      checks: buildFullHookChecks(),
    },
    'pre-merge-commit': {
      description: 'pre-merge-commit 钩子：与 pre-push 相同的 full profile 质量门',
      defaultTimeoutMs: REGISTRY_FULL_TIMEOUT_MS,
      checks: buildFullHookChecks(),
    },
  },
};

export type GateNodePath = string;

function walkRegistryPaths(
  prefix: string,
  node: GateHookNode | GateLeafNode,
  paths: string[],
  container?: 'checks' | 'rules',
): void {
  paths.push(prefix);
  const hook = node as GateHookNode;
  if (hook.checks) {
    for (const [id, child] of Object.entries(hook.checks)) {
      walkRegistryPaths(`${prefix}.checks.${id}`, child, paths);
    }
  }
  if (hook.rules) {
    for (const [id, child] of Object.entries(hook.rules)) {
      walkRegistryPaths(`${prefix}.rules.${id}`, child, paths);
    }
  }
  void container;
}

/** 注册表中全部点分路径（hook + leaf） */
export function listAllGatePaths(): GateNodePath[] {
  const paths: string[] = [];
  for (const section of ['ide', 'git'] as const) {
    for (const [hookId, hookNode] of Object.entries(GATE_REGISTRY[section])) {
      walkRegistryPaths(`${section}.${hookId}`, hookNode, paths);
    }
  }
  return paths.sort();
}

export function getRegistryNode(path: string): GateLeafNode | GateHookNode | undefined {
  const parts = path.split('.');
  if (parts.length < 2) return undefined;
  const section = parts[0];
  if (section !== 'ide' && section !== 'git') return undefined;
  const hookId = parts[1];
  if (!hookId) return undefined;
  const root = GATE_REGISTRY[section];
  const hookNode = root[hookId];
  if (!hookNode) return undefined;
  let current: GateHookNode | GateLeafNode = hookNode;
  for (let i = 2; i < parts.length; i++) {
    const part = parts[i];
    if (!part) return undefined;
    if (part === 'checks' || part === 'rules') {
      if (i + 1 >= parts.length) return undefined;
      const childKey = parts[i + 1];
      if (!childKey) return undefined;
      const hook = current as GateHookNode;
      const bucket = part === 'checks' ? hook.checks : hook.rules;
      const child = bucket?.[childKey];
      if (!child) return undefined;
      current = child;
      i += 1;
      continue;
    }
    return undefined;
  }
  return current;
}

export function getRegistryDefaultTimeoutMs(path: string): number | undefined {
  const hookRoot = getHookRootPath(path);
  const hookNode = getRegistryNode(hookRoot);
  if (hookNode?.defaultTimeoutMs !== undefined) {
    return hookNode.defaultTimeoutMs;
  }
  if (hookRoot === 'git.pre-commit') return REGISTRY_COMMIT_TIMEOUT_MS;
  if (hookRoot === 'git.pre-push' || hookRoot === 'git.pre-merge-commit') return REGISTRY_FULL_TIMEOUT_MS;
  return undefined;
}

/** 总项 hook 路径（用于 timeout 上限） */
export function getHookRootPath(path: string): string {
  const parts = path.split('.');
  const head = parts[0] ?? '';
  const hook = parts[1] ?? '';
  if (head === 'git' && hook) {
    return `${head}.${hook}`;
  }
  if (head === 'ide' && hook) {
    return `${head}.${hook}`;
  }
  return path;
}

export function getRegistryControlIds(path: string): string[] | undefined {
  return getRegistryNode(path)?.controlIds;
}

export function nodeSupportsAutoFix(path: string): boolean {
  const node = getRegistryNode(path);
  if (!node) return false;
  if (node.supportsAutoFix === true) return true;
  if (path.includes('.checks.')) {
    const suffix = path.slice(path.lastIndexOf('.checks.') + '.checks.'.length);
    return AUTO_FIXABLE_CHECK_IDS.has(suffix);
  }
  return false;
}

function formatDurationMs(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    return `${String(ms / 60_000)}m`;
  }
  if (ms >= 1000 && ms % 1000 === 0) {
    return `${String(ms / 1000)}s`;
  }
  return `${String(ms)}ms`;
}

function indent(level: number): string {
  return '  '.repeat(level);
}

function emitYamlNode(
  lines: string[],
  key: string,
  node: GateHookNode | GateLeafNode,
  level: number,
  isHook: boolean,
  parentAutoFix?: boolean,
): void {
  lines.push(`${indent(level)}# ${node.description}`);
  if (node.controlIds && node.controlIds.length > 0) {
    lines.push(`${indent(level)}# controlIds: ${node.controlIds.join(', ')}`);
  }
  lines.push(`${indent(level)}${key}:`);
  const next = level + 1;
  lines.push(`${indent(next)}enabled: true`);
  const hookAutoFix = node.supportsAutoFix === true || parentAutoFix === true;
  if (isHook && hookAutoFix) {
    lines.push(`${indent(next)}autoFix: true`);
  }
  if (isHook && node.defaultTimeoutMs !== undefined) {
    lines.push(`${indent(next)}timeout: ${formatDurationMs(node.defaultTimeoutMs)}`);
  }
  const hook = node as GateHookNode;
  if (hook.checks && Object.keys(hook.checks).length > 0) {
    lines.push(`${indent(next)}checks:`);
    for (const [checkId, checkNode] of Object.entries(hook.checks)) {
      const showTimeout =
        checkNode.defaultTimeoutMs !== undefined &&
        (hook.defaultTimeoutMs === undefined || checkNode.defaultTimeoutMs !== hook.defaultTimeoutMs);
      lines.push(`${indent(next + 1)}# ${checkNode.description}`);
      if (checkNode.controlIds && checkNode.controlIds.length > 0) {
        lines.push(`${indent(next + 1)}# controlIds: ${checkNode.controlIds.join(', ')}`);
      }
      lines.push(`${indent(next + 1)}${checkId}:`);
      lines.push(`${indent(next + 2)}enabled: true`);
      if (checkNode.supportsAutoFix && hookAutoFix) {
        lines.push(`${indent(next + 2)}autoFix: true`);
      }
      if (showTimeout && checkNode.defaultTimeoutMs !== undefined) {
        lines.push(`${indent(next + 2)}timeout: ${formatDurationMs(checkNode.defaultTimeoutMs)}`);
      }
    }
  }
  if (hook.rules && Object.keys(hook.rules).length > 0) {
    lines.push(`${indent(next)}rules:`);
    for (const [ruleId, ruleNode] of Object.entries(hook.rules)) {
      lines.push(`${indent(next + 1)}# ${ruleNode.description}`);
      lines.push(`${indent(next + 1)}${ruleId}:`);
      lines.push(`${indent(next + 2)}enabled: true`);
    }
  }
}

/** 生成完整 example YAML（全部 enabled: true + registry 默认 timeout） */
export function generateExampleYaml(): string {
  const lines: string[] = ['# 质量门全量白名单配置 — 由 gate-registry.generateExampleYaml() 生成', ''];
  for (const section of ['ide', 'git'] as const) {
    lines.push(`${section}:`);
    for (const [hookId, hookNode] of Object.entries(GATE_REGISTRY[section])) {
      emitYamlNode(lines, hookId, hookNode, 1, true);
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}
