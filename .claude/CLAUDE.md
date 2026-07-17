# 项目安全指令 - Claude Code Hooks 安全增强体系

<!-- markdownlint-disable MD013 -->

## 推送规则（最高优先级）

- **禁止 `git push origin main` / `git push origin master`**：main/master 只能通过 PR 合并，**绝不能直接 push**。
- **禁止 `git push --force` 到任何分支**（尤其 main/master），由 `block-dangerous-commands.ts` 硬阻断。
- **正确流程**：`git push -u origin <feature-分支>` → 在 GitHub 发起 PR → CI 通过后合并。
- 即使本地 push/merge 质量门已禁用（见下文），此规则仍由 `block-dangerous-commands.ts` 和项目流程强制执行，**AI 不得尝试绕过**。

## 本地安全架构（实时门 + 提交门）

本项目部署多层安全架构，所有本地 hook 均为硬性阻断。Claude 必须主动遵守以下规范以避免被 hook 拦截。

### 写入门（自动触发）

- **分支隔离**：禁止在 master/main 分支上直接修改文件。请在 feature 分支或 worktree 中开发。
- **危险命令拦截**：rm -rf ~、dd、fork bomb 等命令会被自动拦截。
- **工具限制**：请使用 `uv` (Python) 和 `bun` (JS)，不要使用 pip/npm/pnpm/yarn/npx/node/python/python3。
- **敏感文件保护**：禁止读写 .env、.ssh/id_rsa、.aws/credentials 等敏感文件。

### 快速门（文件写入后自动触发）

- 每次文件写入后自动运行 ESLint + Ruff + Pyright + Prettier 检查。
- 通过检查的文件自动 `git add` 暂存。

### 提交门（git commit 时触发，启用中）

- **Commit 格式**：必须使用 `类型: 描述` 格式，如 `feat: 新增功能`。
- 允许的类型：feat, fix, refactor, docs, test, chore, style, perf。
- 禁止提交敏感文件，自动运行依赖审计和关联测试。

### 推送门 / 合并门（已禁用，让位给 CI）

- **状态**：`.claude/quality-gate.yaml` 中 `git.pre-push.enabled: false`、`git.pre-merge-commit.enabled: false`。
- **接管方**：中央 CI 模板（`pr9898/ci-templates`，详见 `docs/ci-cd-migration.md`）在 PR 流水线运行 typecheck / lint / semgrep / gitleaks / trivy / knip / dep-audit 等全量检查。
- **AI 行为**：本地 `git push` / `git merge --no-ff` 不会触发本地 full 检查；但**不得**因此跳过 PR 流程或直接 push 到 main/master。
- **回滚**：翻回 `enabled: true` 即可恢复本地 full 门。

## 标准开发流程

1. `git checkout -b feat/your-feature` 创建 feature 分支
2. 在 feature 分支上开发和修改文件
3. `git commit -m "feat: 描述"` 提交（提交门自动检查）
4. `git push -u origin feat/your-feature` 推送到远程（推送门已禁用，直接推送）
5. 在 GitHub 发起 PR → 中央 CI 模板运行 full 检查 → 通过后合并

**终端 alias（可选）**：`git config --global alias.merge-safe '!f(){ git merge --no-ff "$@"; }; f'`

## 工具使用对照表

| 操作            | ❌ 禁止                              | ✅ 请使用                     |
| --------------- | ------------------------------------ | ----------------------------- |
| Python 依赖管理 | pip install / pip3 install           | uv add                        |
| Python 依赖删除 | pip uninstall                        | uv remove                     |
| Python 脚本运行 | python script.py / python3 script.py | uv run python script.py       |
| JS 依赖管理     | npm install / pnpm add / yarn add    | bun add                       |
| JS 依赖删除     | npm uninstall                        | bun remove                    |
| JS 脚本运行     | node script.js                       | bun script.js                 |
| 包执行          | npx package                          | bunx package                  |
| npm ci          | npm ci                               | bun install --frozen-lockfile |

## 注意事项

- 所有安全 hook 为硬性阻断，无法通过 `--no-verify` 或 `-c core.hooksPath` 绕过。
- 禁止 `git push origin main`，请通过 PR/MR 合并。
- worktree 中的开发不受分支隔离限制。
