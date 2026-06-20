# Hooks 职责矩阵

## A. IDE 实时安全

| 检查项 | Hook | 触发 |
|--------|------|------|
| 危险命令 | block-dangerous-commands | PreToolUse Bash |
| 敏感内容 | protect-secrets | Read/Edit/Write/Bash |
| Prompt 密钥 | user-prompt-filter | UserPromptSubmit |
| main 写入禁止 | branch-gate | Write/Edit/Bash |
| 自动暂存 | auto-stage | PostToolUse Edit/Write |
| Stop commit 检查 | auto-commit | Stop agent 模式：未 commit 则 block，要求 Agent 自行 git commit；auto 模式：hook 自动提交 |
| push/merge 修复循环 | gate-retry-stop | push/merge 被 gate 拒绝后，Stop 时 block/followup 直到 full 通过（不自动 push/merge） |

## B. 本地质量三门

| 操作 | Hook | profile | 失败 |
|------|------|---------|------|
| git commit | commit-gate | commit | deny |
| git push | push-gate | full | 未 commit 变更 deny；否则 full gate；失败 + 修复指引；pending → gate-retry-stop |
| git merge | merge-gate | full @ source | 未 commit 变更 deny；否则 full gate；失败 + 修复指引；pending → gate-retry-stop |

共享实现：`checks/*.js` + `quality-gate.js`

**commit profile 检查**（除分支/msg/敏感文件/测试/安全扫描外）：

- JS/TS/Python：eslint、ruff `--preview`、prettier、pyright/tsc（`lint-staged`、`format-staged`、`typecheck`）
- 扩展类型（暂存区）：markdownlint、shellcheck、shfmt、hadolint、taplo、sqlfluff、stylelint（`extended-lint.js`）
- JSON/YAML：check-jsonschema（有 schema 时）、jq/yq 语法（`schema-lint.js`）

**full profile 检查**：上述扩展类型与 schema 检查的全仓库版本，外加 semgrep/trivy/gitleaks/knip、全量测试与覆盖率等。

**工具未安装策略**：full/commit 所需外部工具（bun、semgrep、trivy、gitleaks、ruff、pyright/uv、shellcheck、hadolint 等）在存在对应文件时缺失一律 **deny**，不 fail-open skip。

## C. 远程 CI

**无** `hooks-ci.yml`。质量门禁完全在本地 IDE hook。

Branch Protection：禁 force push 到 main/master（`block-dangerous-commands`）；非 force push 由 `push-gate` full 检查放行。

## D. 已移除

- branch-gate worktree bypass
- PR gate / pull_request CI

（原 `post-write-lint` PostToolUse 增量 lint 已并入 commit/full 质量门。）

## E. P3

见 [hooks-security-roadmap.md](./hooks-security-roadmap.md) 与 `.github/workflows/dast.yml`（stub）。
