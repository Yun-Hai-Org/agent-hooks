# Hooks 职责矩阵

## A. IDE 实时安全

| 检查项 | Hook | 触发 |
|--------|------|------|
| 危险命令 | block-dangerous-commands | PreToolUse Bash |
| 敏感内容 | protect-secrets | Read/Edit/Write/Bash |
| Prompt 密钥 | user-prompt-filter | UserPromptSubmit |
| main 写入禁止 | branch-gate | Write/Edit/Bash |
| 自动暂存 | auto-stage | PostToolUse Edit/Write |
| 自动提交 | auto-commit | Stop → commit 检查 → 自动提交；失败 block/followup 重试 |
| push/merge 修复循环 | gate-retry-stop | push/merge 被 gate 拒绝后，Stop 时 block/followup 直到 full 通过（不自动 push/merge） |

## B. 本地质量三门

| 操作 | Hook | profile | 失败 |
|------|------|---------|------|
| git commit | commit-gate | commit | deny |
| git push | push-gate | full | deny + 修复指引；pending → gate-retry-stop |
| git merge | merge-gate | full @ source | deny + 修复指引；pending → gate-retry-stop |

共享实现：`checks/*.js` + `quality-gate.js`

**工具未安装策略**：full/commit 所需外部工具（bun、semgrep、trivy、gitleaks、ruff、pyright/uv 等）缺失时一律 **deny**，不 fail-open skip。

## C. 远程 CI

**无** `hooks-ci.yml`。质量门禁完全在本地 IDE hook。

Branch Protection：禁 force push、禁直推 main（`block-dangerous-commands`）。

## D. 已移除

- post-write-lint（增量 lint）
- branch-gate worktree bypass
- PR gate / pull_request CI

## E. P3

见 [hooks-security-roadmap.md](./hooks-security-roadmap.md) 与 `.github/workflows/dast.yml`（stub）。
