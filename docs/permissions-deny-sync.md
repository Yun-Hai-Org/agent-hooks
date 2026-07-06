# permissions.deny 同步与安装

Claude Code 的 `permissions.deny` 与本仓库 PreToolUse hooks 构成**双层防护**：IDE 层在工具调用前硬拒绝匹配规则；hooks 层处理需要上下文、正则或工作流状态的检查。

## 双层架构

| 层 | 机制 | 职责 |
| --- | --- | --- |
| **permissions.deny** | `~/.claude/settings.json` | 静态 Bash / Read / Edit 模式，无运行时上下文即可判定 |
| **PreToolUse hooks** | `~/.claude/hooks`（软链至本仓库） | 分支门、工作流门、内容扫描、合并状态等上下文相关检查 |

SSOT 为 `.claude/permissions-deny.registry.ts`：每条记录可带 `rule`（同步到 deny）或 `hookOnly: true`（仅由 hooks 执行）。

## 三路同步

```
permissions-deny.registry.ts
        │
        ├─► .claude/settings.permissions-deny.example.json   （仓库示例，CI/check 对照）
        └─► ~/.claude/settings.json                          （全局，仅 merge permissions.deny）
```

同步脚本：`scripts/sync-claude-permissions-deny.ts`。从 registry 读取 `getDenyRules()`（过滤 `hookOnly`、去重、排序），写入 repo example；更新全局时**只覆盖** `permissions.deny`，保留 `permissions.allow` 及其他顶层字段。全局写入前会备份为 `settings.json.bak.<timestamp>`。

### CLI 用法

```bash
bun scripts/sync-claude-permissions-deny.ts              # 同步 repo example + 全局 settings
bun scripts/sync-claude-permissions-deny.ts --dry-run    # 预览，不写文件
bun scripts/sync-claude-permissions-deny.ts --check    # 校验 registry 与已生成文件一致（CI）
bun scripts/sync-claude-permissions-deny.ts --repo-only  # 仅更新 .claude/settings.permissions-deny.example.json
```

环境变量 `CLAUDE_SETTINGS_PATH` 可覆盖默认全局路径（`~/.claude/settings.json`）。

## hookOnly 规则（不同步到 permissions.deny）

以下条目在 registry 中标记 `hookOnly: true`，**不会**出现在 `permissions.deny`，原因如下。

### branch-gate

| ID | 原因 |
| --- | --- |
| `branch-gate-main-write` | 需根据当前分支、路径判断 main/master 上是否允许 Write/Edit/Bash |

### workflow-gate

| ID | 原因 |
| --- | --- |
| `worktree-gate` | 主 checkout 写入限制依赖 agent 角色与工作树布局 |
| `workflow-gate` | TodoWrite 先于 Read 的编排门，需 session 状态 |
| `orchestrator-gate` | 编排者禁止直接 Read/Write，需 `agent_id` 上下文 |
| `git-ship-gate` | ship/merge 阶段限制 git 写操作，需工作流阶段 |

### 内容扫描（protect-secrets）

| ID | 原因 |
| --- | --- |
| `protect-secrets-content` | 扫描 Write/Edit **正文**中的密钥模式，非文件路径匹配 |

路径级敏感文件仍通过 `Read(//**/…)` / `Edit(//**/…)` 同步到 deny。

### 合并状态（block-dangerous-commands，hookOnly）

| ID | 原因 |
| --- | --- |
| `merge-ff-bypass` | 受保护分支上的 fast-forward merge 需 cwd/分支上下文 |
| `merge-squash-bypass` | squash merge 绕过 pre-merge-commit，需分支上下文 |
| `merge-conclude-bypass` | `git merge --continue` 需 `MERGE_HEAD` 等工作区状态 |
| `git-pull-merge` | `git pull` 触发的 merge 需远程/分支上下文 |

其他 `hookOnly` 危险命令（如 fork bomb、download-then-exec、nc 反弹 shell）因 permissions 语法无法精确表达，仍仅由 `block-dangerous-commands` hook 拦截。

## 全局 Read 规则与 `//**/` 前缀

Claude Code 在用户级 `~/.claude/settings.json` 中匹配**任意路径**的 Read/Edit deny 规则时，路径 glob 须使用 `//**/` 前缀（例如 `Read(//**/.env)`），否则规则可能只对相对路径生效。registry 中 `PROTECT_SECRETS_FILE_ENTRIES` 已统一使用该前缀；同步脚本原样写入 example 与全局 settings。

## 安装

一次性链接 hooks 并可选同步 deny：

```bash
./scripts/link-cursor-hooks-global.sh --with-permissions-deny
```

仅链接 hooks（不同步 deny）：

```bash
./scripts/link-cursor-hooks-global.sh
```

也可显式指定仓库根：

```bash
./scripts/link-cursor-hooks-global.sh --with-permissions-deny /path/to/hooks-repo
```

`--with-permissions-deny` 在 symlink 步骤完成后执行：

```bash
bun "$HOOKS_REPO/scripts/sync-claude-permissions-deny.ts"
```

安装后**重启 Cursor**，以便 IDE 重新加载 hooks 与 settings。

## skipDangerousModePermissionPrompt

全局 `~/.claude/settings.json` 中若启用 `skipDangerousModePermissionPrompt`，Claude Code 会对部分危险操作跳过额外确认提示。在已通过 sync 写入完整 `permissions.deny` 的前提下，静态 deny 与 hooks 已承担拦截职责；是否开启该选项取决于团队偏好——开启可减少重复弹窗，但应确保 deny 列表与 hooks 保持同步（定期运行 `--check` 或安装时使用 `--with-permissions-deny`）。
