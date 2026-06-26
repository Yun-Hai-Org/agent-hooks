# Hooks 职责矩阵

## A. IDE 实时安全（Cursor + Claude 双端 parity）

| 检查项          | Hook                     | Claude 触发            | Cursor 触发                      |
| --------------- | ------------------------ | ---------------------- | -------------------------------- |
| 危险命令        | block-dangerous-commands | PreToolUse Bash        | beforeShellExecution             |
| 敏感内容        | protect-secrets          | Read/Edit/Write/Bash   | beforeReadFile + preToolUse      |
| Prompt 密钥     | user-prompt-filter       | UserPromptSubmit       | beforeSubmitPrompt               |
| main 写入禁止   | branch-gate              | Write/Edit/Bash        | preToolUse Shell/Write           |
| 未合并分支删除  | branch-delete-gate       | PreToolUse Bash        | beforeShellExecution             |
| 工具健康检查    | session-start            | SessionStart           | sessionStart                     |
| 写入后格式化    | format-on-write          | PostToolUse Edit/Write | afterFileEdit（先于 auto-stage） |
| 安全 Webhook    | notification / notify    | Notification + BLOCKED | BLOCKED 直连                     |
| 自动暂存        | auto-stage               | PostToolUse Edit/Write | afterFileEdit                    |
| Stop commit     | auto-commit              | Stop                   | stop                             |
| push/merge 修复 | gate-retry-stop          | Stop                   | stop                             |

**Hook 进程 PATH**：Cursor/Claude 钩子子进程的 PATH 通常不含 `~/.cursor`（bun 所在目录）。
`security-orchestrator.getHookProcessEnv()` 集中 augment PATH（与全局 git hook shell wrapper 的
`export PATH="${HOME}/.cursor:..."` 对齐），供 `session-start` 工具检测、`execCommand` 与
`resolve-hook-path` spawn 使用。

## B. 本地质量三门（Git native only）

| 操作           | Native Hook      | profile       | 失败                  |
| -------------- | ---------------- | ------------- | --------------------- |
| git commit     | pre-commit       | commit        | exit 1                |
| commit message | commit-msg       | message 规则  | exit 1                |
| git push       | pre-push         | full          | exit 1 + gate-pending |
| git merge      | pre-merge-commit | full @ 合并树 | exit 1 abort merge    |

### 安装方式

| 模式       | 命令                                    | 作用域                                                      |
| ---------- | --------------------------------------- | ----------------------------------------------------------- |
| **全局**   | `./scripts/install-git-hooks-global.sh` | `git config --global core.hooksPath ~/.git-hooks`，所有仓库 |
| **单仓库** | `./scripts/install-git-hooks.sh`        | local `core.hooksPath=.githooks`（软链模板），覆盖 global   |

前置（一次性）：

```bash
./scripts/link-cursor-hooks-global.sh      # ~/.claude/hooks + ~/.cursor/bun
./scripts/install-quality-tools-global.sh  # brew/uv 机器级 CLI
```

运行时通过 `git rev-parse --show-toplevel` 绑定各项目代码与配置（`pyproject.toml`、`eslint.config.*`、`.gitleaks.toml` 等），无需在每个仓库复制 hook 脚本。

### 工具安装分层

| 层级            | 说明                            | 其他项目是否重复安装  |
| --------------- | ------------------------------- | --------------------- |
| A. 机器全局 CLI | gitleaks、semgrep、trivy、uv 等 | 否                    |
| B. 项目级依赖   | `bun install` / `uv sync`       | 是（有 JS/Python 时） |
| C. 条件触发     | 无相关文件则 SKIP               | —                     |

**工具未安装策略**：所需外部工具缺失一律 **deny**（ruff 可通过 `uv run ruff`）。

### 排除特定仓库

| 方式              | 操作                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------- |
| A. 单仓库 opt-out | `./scripts/disable-git-hooks-in-repo.sh`（`git config --local hooks.qualityGate false`） |
| B. 全局排除列表   | 编辑 `~/.claude/hooks-exclude`（一行一个绝对路径，`/` 结尾为前缀匹配）                   |
| C. 彻底禁用 hooks | `git config --local core.hooksPath .git/hooks`                                           |

非 hooks 项目（无 `.claude/hooks/quality-gate.ts`）自动 **SKIP** hook-unit-tests / knip 等 hooks 专用检查。

### hooks 仓库策略 B（避免 Cursor 双触发）

在本 hooks 仓库内开发时，**不要**保留项目级 `.cursor/hooks.json`。配置源为 `.cursor/hooks.json.example`；全局安装脚本将其软链到 `~/.cursor/hooks.json`：

```bash
./scripts/link-cursor-hooks-global.sh
./scripts/install-git-hooks-global.sh
./scripts/apply-hooks-repo-strategy-b.sh   # 取消本仓库 local core.hooksPath
```

完成后重启 Cursor。业务项目（如 yingmi）通常仅依赖全局 hooks，无需项目级 `.cursor/hooks.json`。

**写入后自动 fix**：`afterFileEdit` 顺序为 `format-on-write` → `auto-stage`
（prettier / markdownlint / ruff format / shfmt / taplo）。pre-commit 仍只做 `--check`，不在 commit 内静默 `--write`。

共享实现：`checks/*.ts` + `quality-gate.ts` + `~/.claude/hooks/native/*.ts`

**commit profile 检查**：分支/msg/敏感文件/暂存 lint/format/测试/安全扫描等。

**full profile 检查**：全仓库 lint/format/测试/semgrep/trivy/gitleaks 等（knip 仅 hooks 项目）。

## C. Agent 防绕过（IDE only）

| 规则                                  | Hook                     |
| ------------------------------------- | ------------------------ |
| `--no-verify` / `core.hooksPath`      | block-dangerous-commands |
| `gh pr merge` / 默认 `git pull` merge | block-dangerous-commands |
| `git update-ref -d refs/heads/*`      | block-dangerous-commands |
| 未合并分支/worktree 删除              | branch-delete-gate       |

## D. 已移除

- IDE commit-gate / push-gate / merge-gate（质量检查改由 `.githooks`）
- merge-gate source 分支 worktree 预扫
- branch-gate worktree bypass

## E. P3

见 [hooks-security-roadmap.md](./hooks-security-roadmap.md) 与 `.github/workflows/dast.yml`（stub）。

## F. 可选后续（未纳入当前实现）

| 项                         | 说明                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| squash 调试 commit         | yingmi 分支未 push 时可 `git rebase -i` 合并 `test:` 系列 commit |
| fix-staged 兜底            | 终端手改路径时的 `--write` 脚本（非 Cursor 写入路径）            |
| eslint / ruff check --fix  | format-on-write 二期                                             |
| baseline `.prettierignore` | 若要把完整 sequence baseline 重新纳入 git                        |
