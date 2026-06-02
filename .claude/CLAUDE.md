# 项目安全指令 - Claude Code Hooks 安全增强体系

## 四门安全架构

本项目部署了**四门安全架构**，所有 hook 均为硬性阻断。Claude 必须主动遵守以下规范以避免被 hook 拦截。

### 写入门（自动触发）
- **分支隔离**：禁止在 master/main 分支上直接修改文件。请在 feature 分支或 worktree 中开发。
- **危险命令拦截**：rm -rf ~、dd、fork bomb 等命令会被自动拦截。
- **工具限制**：请使用 `uv` (Python) 和 `bun` (JS)，不要使用 pip/npm/pnpm/yarn/npx/node/python/python3。
- **敏感文件保护**：禁止读写 .env、.ssh/id_rsa、.aws/credentials 等敏感文件。

### 快速门（文件写入后自动触发）
- 每次文件写入后自动运行 ESLint + Ruff + Pyright + Prettier 检查。
- 通过检查的文件自动 `git add` 暂存。

### 提交门（git commit 时触发）
- **Commit 格式**：必须使用 `类型: 描述` 格式，如 `feat: 新增功能`。
- 允许的类型：feat, fix, refactor, docs, test, chore, style, perf。
- 禁止提交敏感文件，自动运行依赖审计和关联测试。

### 合并门（git merge 到 master/main 时触发）
- 自动运行 Semgrep + Knip + Trivy 全量安全扫描。
- 运行全量测试和覆盖率检查。
- 全部通过才允许合并。

## 标准开发流程

1. `git checkout -b feat/your-feature` 创建 feature 分支
2. 在 feature 分支上开发和修改文件
3. `git commit -m "feat: 描述"` 提交（提交门自动检查）
4. `git checkout main && git merge feat/your-feature` 合并（合并门自动检查）

## 工具使用对照表

| 操作 | ❌ 禁止 | ✅ 请使用 |
|------|--------|----------|
| Python 依赖管理 | pip install / pip3 install | uv add |
| Python 依赖删除 | pip uninstall | uv remove |
| Python 脚本运行 | python script.py / python3 script.py | uv run python script.py |
| JS 依赖管理 | npm install / pnpm add / yarn add | bun add |
| JS 依赖删除 | npm uninstall | bun remove |
| JS 脚本运行 | node script.js | bun script.js |
| 包执行 | npx package | bunx package |
| npm ci | npm ci | bun install --frozen-lockfile |

## 注意事项

- 所有安全 hook 为硬性阻断，无法通过 `--no-verify` 或 `-c core.hooksPath` 绕过。
- 禁止 `git push origin main`，请通过 PR/MR 合并。
- worktree 中的开发不受分支隔离限制。
