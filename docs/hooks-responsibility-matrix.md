# Hooks 职责矩阵

## A. IDE 实时安全（Cursor + Claude 双端 parity）

| 检查项          | Hook                     | Claude 触发            | Cursor 触发                 |
| --------------- | ------------------------ | ---------------------- | --------------------------- |
| 危险命令        | block-dangerous-commands | PreToolUse Bash        | beforeShellExecution        |
| 敏感内容        | protect-secrets          | Read/Edit/Write/Bash   | beforeReadFile + preToolUse |
| Prompt 密钥     | user-prompt-filter       | UserPromptSubmit       | beforeSubmitPrompt          |
| main 写入禁止   | branch-gate              | Write/Edit/Bash        | preToolUse Shell/Write      |
| 工具健康检查    | session-start            | SessionStart           | sessionStart                |
| 安全 Webhook    | notification / notify    | Notification + BLOCKED | BLOCKED 直连                |
| 自动暂存        | auto-stage               | PostToolUse Edit/Write | afterFileEdit               |
| Stop commit     | auto-commit              | Stop                   | stop                        |
| push/merge 修复 | gate-retry-stop          | Stop                   | stop                        |

## B. 本地质量三门（Git native only）

| 操作           | Native Hook      | profile       | 失败                  |
| -------------- | ---------------- | ------------- | --------------------- |
| git commit     | pre-commit       | commit        | exit 1                |
| commit message | commit-msg       | message 规则  | exit 1                |
| git push       | pre-push         | full          | exit 1 + gate-pending |
| git merge      | pre-merge-commit | full @ 合并树 | exit 1 abort merge    |

安装：`./scripts/install-git-hooks.sh`（设置 `core.hooksPath=.githooks`）

共享实现：`checks/*.js` + `quality-gate.js`

**commit profile 检查**：分支/msg/敏感文件/暂存 lint/format/测试/安全扫描等。

**full profile 检查**：全仓库 lint/format/测试/semgrep/trivy/gitleaks/knip 等。

**工具未安装策略**：所需外部工具缺失一律 **deny**（ruff 可通过 `uv run ruff`）。

## C. Agent 防绕过（IDE only）

| 规则                                  | Hook                     |
| ------------------------------------- | ------------------------ |
| `--no-verify` / `core.hooksPath`      | block-dangerous-commands |
| `gh pr merge` / 默认 `git pull` merge | block-dangerous-commands |

## D. 已移除

- IDE commit-gate / push-gate / merge-gate（质量检查改由 `.githooks`）
- merge-gate source 分支 worktree 预扫
- branch-gate worktree bypass

## E. P3

见 [hooks-security-roadmap.md](./hooks-security-roadmap.md) 与 `.github/workflows/dast.yml`（stub）。
