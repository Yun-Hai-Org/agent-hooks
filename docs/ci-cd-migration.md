# CI/CD 迁移分析报告

> 将项目 `.claude/hooks/` 检查体系中可迁移到 CI/CD（GitHub Actions / GitLab CI）的检查项整理为落地清单。
>
> 范围：静态分析与格式化（A）、安全扫描（B）、依赖审计（C）三大类共 13 项可直接落地的检查，另附 K8s/OpenAPI/SBOM/DAST（E）和测试（D）作为可选扩展。

---

## 1. 概述

### 项目检查体系现状

- `.claude/hooks/checks/` 目录共 **31 个检查脚本**
- `.claude/hooks/` 根目录共 **35 个 hook 脚本**
- 通过 `quality-gate.ts` 暴露两个 profile：
  - `commit` profile：14 项异步检查 + 3 项同步检查（pre-commit 用）
  - `full` profile：25 项检查（pre-push / pre-merge 用）

### 已有 CI 配置

| 文件                         | 内容                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `.github/workflows/dast.yml` | ZAP API 扫描 + OpenAPI 认证负向测试（push 到 main/master + OpenAPI 变更时触发） |

### 缺失

- 无 `.gitlab-ci.yml`
- 无 PR 级别的 CI 编排
- 无针对静态分析、安全扫描、依赖审计的 GitHub Actions 流水线

### 定位原则

CI 不应取代本地 hook，而是作为 **远程最终保障**：

- **本地门**：做"快速反馈"，依赖 git 暂存区、会话上下文的检查（如 lint-staged、branch-gate）
- **CI 门**：做"全量权威检查"，纯静态分析、全量安全扫描、跨 PR 的依赖审计

---

## 2. 检查项分类总览

### 可迁移到 CI 的检查（22 项，纯静态/无 git 暂存区依赖）

| 类别                             | 数量 | 检查项                                                                        |
| -------------------------------- | ---- | ----------------------------------------------------------------------------- |
| A. 静态分析与格式化              | 4    | type-check / lint-full / extended-lint / format-full                          |
| B. 安全扫描                      | 6    | semgrep / gitleaks / trivy / knip / iac-checkov / opa-conftest                |
| C. 依赖审计                      | 3    | dep-audit / py-dep-audit / lockfile-freshness                                 |
| D. 测试与覆盖率（可选）          | 4    | full-tests / hook-unit-tests / hook-adversarial / coverage                    |
| E. K8s/OpenAPI/SBOM/DAST（可选） | 5    | k8s-lint / openapi-contract / zap-api-dast / fintech-sbom / payment-page-full |

### 必须保留为本地 hook 的检查（12 项）

依赖 git 暂存区状态、实时命令拦截或 CLI 会话上下文，无法在 CI 中复现：

- `branch-gate` / `worktree-gate` / `branch-delete-gate` — 依赖当前分支与会话上下文
- `commit-msg` / `sensitive-files`（git-policy）— 依赖暂存区与 commit message
- `lint-staged` / `format-staged` / `code-review-staged` — 仅扫描暂存区 diff
- `protect-secrets` / `block-dangerous-commands` — 实时拦截 Read/Write/Bash
- `format-on-write` / `auto-stage` / `auto-commit` — 依赖 Write 工具事件循环
- `git-ship-gate` — 依赖 agent role

---

## 3. A. 静态分析与格式化（4 项）

### CI 命令对照

| 检查          | 命令                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| type-check    | `bunx tsc --noEmit` + `uv run pyright .`                                                               |
| lint-full     | `bun eslint --max-warnings 0 .claude/hooks` + `uv run ruff check .`                                    |
| extended-lint | `hadolint **/Dockerfile` + `shellcheck **/*.sh` + `bunx stylelint **/*.css` + `sqlfluff lint **/*.sql` |
| format-full   | `bun prettier --check .` + `uv run ruff format --check .`                                              |

### 平台差异点

**GitHub Actions：**

- 工具安装走官方 action：`oven-sh/setup-bun@v2`、`astral-sh/setup-uv@v3`、`hadolint/hadolint-action@v3`、`ludeeus/action-shellcheck@master`
- 缓存用 `actions/cache@v4`，key 用 `{{ hashFiles('bun.lock', 'uv.lock') }}`

**GitLab CI：**

- 用 `image: node:22` + `before_script:` 装 bun；或直接用 `oven/bun:latest` 镜像
- uv 走 `astral-sh/uv` 官方镜像
- 缓存用 `cache:` 关键字，`key: $CI_COMMIT_REF_SLUG-bun`，`paths: [.bun-install-cache, .uv-cache]`

### 注意事项

- `tsc --noEmit` 必须用 `bunx`（项目 CLAUDE.md 禁用 `npx`/`node`）
- `ruff check .` 和 `ruff format --check .` 要分开跑——后者是格式校验，前者是规则校验
- `prettier --check .` 在 CI 中要用 `--check` 而非 `--write`，避免修改文件
- extended-lint 工具多，建议拆为 4 个并行 job（GitHub 用 matrix，GitLab 用 `parallel: 4` + `matrix:`），单个工具失败不阻塞其他

---

## 4. B. 安全扫描（6 项）

### CI 命令对照

| 检查         | 命令                                                                                  | 备注                                                                              |
| ------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| semgrep      | `semgrep ci --config auto`                                                            | 用 `--config auto` 自动选择规则集；产物 `semgrep.sarif` 上传 GitHub Code Scanning |
| gitleaks     | `gitleaks detect --source . --no-banner --redact`                                     | `--redact` 避免密钥明文进日志；GitHub 用 `gitleaks/gitleaks-action@v2`            |
| trivy        | `trivy fs --severity HIGH,CRITICAL --exit-code 1 .` + `trivy config .`                | 两步：fs 扫文件系统漏洞，config 扫 IaC 配置                                       |
| knip         | `bun knip`                                                                            | JS 死代码；CI 中加 `--reporter json` 便于解析                                     |
| iac-checkov  | `checkov --directory . --framework terraform,dockerfile,kubernetes --compact --quiet` | 仅当仓库有 IaC 文件时才跑                                                         |
| opa-conftest | `conftest test . --combine --parser yaml,json`                                        | 需要 `policy/` 目录存在 Rego 规则                                                 |

### GitHub Actions 特有能力

- **Semgrep SARIF 上传**：`semgrep/semgrep-action@v1` 后接 `github/codeql-action/upload-sarif@v3`，结果会出现在仓库 Security 标签页
- **Trivy SBOM + 上传**：`trivy fs --format spdx-json -o sbom.spdx.json .`，再用 `actions/upload-artifact@v4` 归档
- **Gitleaks PR 评论**：用 `gitleaks/gitleaks-action@v2` 自动在 PR 上评论泄露位置

### GitLab CI 特有能力

- **Semgrep 报告**：`artifacts.reports.sast:` 关键字，结果出现在 MR 的 Security 标签
- **Trivy 集成**：用 `template` 字段生成 GitLab SAST 报告格式：`trivy fs --format gitlab --output gl-sast-report.json .`
- **Gitleaks**：用默认 `gitleaks` job 模板（GitLab 自带 SAST 模板库）

### 注意事项

- semgrep 配置走 `--config auto` 时需要 `SEMGREP_RULES_FILE` 或 `SEMGREP_APP_TOKEN` 环境变量
- trivy 数据库每日更新，CI 缓存 `~/.cache/trivy/db` 时设置 `refresh_interval: 24h`
- checkov/conftest 只在仓库有对应文件时跑——用 `paths:` 或 `changes:` 过滤触发
- knip 在 CI 用 `--no-progress`，避免终端控制字符污染日志

---

## 5. C. 依赖审计（3 项）

### CI 命令对照

| 检查               | 命令                                                 | 备注                                                   |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------ |
| dep-audit (JS)     | `bun audit --production`                             | `--production` 跳过 dev 漏洞（按需）                   |
| py-dep-audit       | `uv run pip-audit` 或 `osv-scanner -r .`             | pip-audit 查 PyPI advisory；osv-scanner 查 OSV 数据库  |
| lockfile-freshness | `bun install --frozen-lockfile` + `uv sync --frozen` | 必须用 `--frozen`，lockfile 与 manifest 不一致直接失败 |

### 平台差异点

**GitHub Actions：**

- `bun audit` 走 `oven-sh/setup-bun@v2` 自带；产物无 SARIF，需要用 `actions/github-script@v7` 解析 JSON
- `pip-audit` 走 `astral-sh/setup-uv@v3` + `uv run pip-audit -f json`
- `osv-scanner` 用 `google/osv-scanner-action@v1`，自动生成 SARIF 上传

**GitLab CI：**

- 依赖审计走 `gemnasium-dependency_scanning` 模板（GitLab 内置），但也可以直接 `bun audit`
- pip-audit 用 `artifacts.reports.dependency_scanning:` 上传 JSON 报告

### 失败阈值建议

- **HIGH/CRITICAL 漏洞**：直接 fail pipeline
- **MEDIUM 漏洞**：警告但不阻塞（用 `trivy --exit-code 0 --severity MEDIUM` + 单独 step 警告）
- **LOW 漏洞**：仅生成报告，不阻塞

### 触发策略

- `bun audit` / `pip-audit`：每次 PR 都跑（快，<30s）
- `osv-scanner`：每天定时跑一次（schedule cron），追踪上游新披露漏洞
- `lockfile-freshness`：每次 PR + 每次 push 都跑

---

## 6. 必须保留为本地 hook 的检查

以下检查依赖 git 暂存区状态、实时命令拦截或 CLI 会话上下文，**无法在 CI 中复现**，必须保留为本地 hook：

| 检查                         | 依赖项                | 不能迁移的原因              |
| ---------------------------- | --------------------- | --------------------------- |
| `branch-gate`                | 当前分支 + 会话上下文 | CI 中分支已固定，无需再检查 |
| `worktree-gate`              | worktree 状态         | CI 无 worktree 概念         |
| `branch-delete-gate`         | CLI 交互流程          | CI 不执行交互式 branch 删除 |
| `commit-msg`                 | commit message        | CI 中 commit 已完成         |
| `sensitive-files`            | 暂存区文件列表        | CI 中已 push，时序错过      |
| `lint-staged`                | 暂存区 diff           | CI 跑全量更彻底             |
| `format-staged`              | 暂存区 diff           | 同上                        |
| `code-review-staged`         | 暂存区 diff           | 同上                        |
| `protect-secrets`            | 实时 Read/Write 拦截  | CI 无实时工具调用           |
| `block-dangerous-commands`   | 实时 Bash 命令分析    | CI 无实时 Bash 拦截         |
| `format-on-write`            | Write 工具事件循环    | CI 无 Write 工具            |
| `auto-stage` / `auto-commit` | Write 工具事件循环    | 同上                        |
| `git-ship-gate`              | agent role + 会话状态 | CI 无 agent 概念            |

---

## 7. 流水线编排建议

### GitHub Actions job 拓扑

```
PR 流水线 (pull_request):
  ├─ job: lint-and-format       (A 的 4 项，串行 step)
  ├─ job: typecheck              (单独 job，便于缓存)
  ├─ job: security-scan          (B 的 6 项，matrix 并行)
  │   └─ matrix: [semgrep, gitleaks, trivy, knip, checkov, conftest]
  ├─ job: dependency-audit       (C 的 3 项，串行)
  └─ job: lockfile-check         (单独 job，最先跑)

push 流水线 (push to feature):
  └─ 同 PR，但加上 full-tests (D 类)

main 流水线 (push to main/master):
  └─ A+B+C+D 全集 + SBOM 归档 (E 类，可选)
```

### GitLab CI stages 拓扑

```yaml
stages: [verify, security, audit, report]

verify: [typecheck, lint, format, extended-lint, lockfile] # 并行
security: [semgrep, gitleaks, trivy, knip, checkov, conftest] # 并行
audit: [bun-audit, pip-audit, osv-scanner] # 并行
report: [sbom-archive, summary] # 串行 needs 全部
```

用 `needs: []` 让所有 job 并行启动；`report` job `needs: [所有 job]` 汇总。

---

## 8. 缓存策略

| 工具     | 缓存路径               | GitHub key                                    | GitLab key                                         |
| -------- | ---------------------- | --------------------------------------------- | -------------------------------------------------- |
| bun      | `~/.bun/install/cache` | `bun-${{ hashFiles('bun.lock') }}`            | `$CI_COMMIT_REF_SLUG-bun-${hashFiles('bun.lock')}` |
| uv       | `~/.cache/uv`          | `uv-${{ hashFiles('uv.lock') }}`              | `$CI_COMMIT_REF_SLUG-uv-${hashFiles('uv.lock')}`   |
| semgrep  | `~/.cache/semgrep`     | 固定 key，每周刷新                            | `semgrep-$CI_COMMIT_REF_SLUG`                      |
| trivy db | `~/.cache/trivy/db`    | `trivy-db-${{ github.run_id }}`，每日 refresh | `trivy-db`，`when: on_failure`                     |
| pyright  | `~/.cache/pyright`     | `pyright-${{ hashFiles('pyproject.toml') }}`  | `pyright-$CI_COMMIT_REF_SLUG`                      |

### 缓存最佳实践

- **lockfile 哈希作为 key**：依赖变更时自动失效，避免缓存陈旧
- **restore-keys 回退**：key 未命中时回退到分支级或全局缓存，加速冷启动
- **trivy db 单独缓存**：数据库每日更新，不能与代码缓存混用
- **缓存只读优先**：CI 中所有缓存应视为只读，避免并发写入污染

---

## 9. 工具版本固定建议

避免 CI 跑出与本地不一致的结果，所有工具版本必须固定：

### 已固定的配置

项目 `package.json` 和 `pyproject.toml` 已部分固定版本：

| 工具              | 当前版本  |
| ----------------- | --------- |
| eslint            | 10.4.1    |
| prettier          | 3.8.3     |
| typescript        | 6.0.3     |
| knip              | ^5.0.0    |
| markdownlint-cli2 | 0.22.1    |
| ruff              | >=0.4.0   |
| pyright           | >=1.1.409 |

### CI 中的版本固定策略

- **GitHub Actions**：用 `bun` / `uv` 的 `frozen-lockfile` 模式，工具版本走 `package.json` 的 devDependencies；action 版本用 `@v2`、`@v3` 等主版本固定
- **GitLab CI**：用固定版本的 Docker 镜像（如 `oven/bun:1.1.42`、`astralsh/uv:0.5.11`），避免 `latest` 漂移

### 第三方工具版本固定

semgrep / trivy / gitleaks / checkov / conftest 等不在 package.json 中的工具：

- GitHub Actions：用 `@v2`、`@v3` 等主版本固定 action，工具版本由 action 内部锁定
- GitLab CI：在 `before_script` 中用 `pip install semgrep==1.50.0` 或下载固定版本的二进制

---

## 10. 结论

### 直接落地（A+B+C 共 13 项）

- **A. 静态分析与格式化**：4 项 — type-check / lint-full / extended-lint / format-full
- **B. 安全扫描**：6 项 — semgrep / gitleaks / trivy / knip / iac-checkov / opa-conftest
- **C. 依赖审计**：3 项 — dep-audit / py-dep-audit / lockfile-freshness

### 按需启用（D+E 共 9 项）

- **D. 测试与覆盖率**：4 项 — full-tests / hook-unit-tests / hook-adversarial / coverage
- **E. K8s/OpenAPI/SBOM/DAST**：5 项 — k8s-lint / openapi-contract / zap-api-dast / fintech-sbom / payment-page-full

### 保留为本地 hook（12 项）

依赖 git 暂存区/会话上下文的检查，无法迁移到 CI。详见第 6 节。

### 实施优先级建议

1. **第一阶段（必装）**：A 类 4 项 + C 类 3 项 — 快速、基础、覆盖所有 PR
2. **第二阶段（推荐）**：B 类 6 项 — 安全扫描，建议在 main 流水线全量启用
3. **第三阶段（按需）**：D 类 4 项 — 测试与覆盖率，与本地 hook 测试互补
4. **第四阶段（场景驱动）**：E 类 5 项 — 仅当项目涉及 K8s/OpenAPI/支付页等场景时启用

### 关键原则

- **CI 不取代本地 hook**：本地门做"快速反馈"，CI 做"全量权威检查"
- **工具版本必须固定**：避免本地与 CI 结果不一致
- **失败阈值分层**：HIGH/CRITICAL 阻断，MEDIUM 警告，LOW 仅报告
- **缓存策略精细化**：lockfile 哈希作为 key，trivy db 单独缓存
