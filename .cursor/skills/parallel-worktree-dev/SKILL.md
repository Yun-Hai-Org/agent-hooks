---
name: parallel-worktree-dev
description: >-
  L3 parallel worktree workflow for Cursor agents: create task worktrees on
  feat/*-task-* branches, dispatch background subagents per todo, integrator
  merges task branches into feat epic, and removes worktrees after merge. Use
  when coordinating multi-SA implementation across isolated git worktrees.
---

# Parallel Worktree Development (L3)

Orchestrator coordinates only. Hooks enforce worktree isolation, Todo-before-Read, and ship via background subagents.

## Branch naming

| Type               | Pattern                 | Example                                    |
| ------------------ | ----------------------- | ------------------------------------------ |
| Epic (integration) | `feat/<name>`           | `feat/hooks-restore-workflow`              |
| Task (parallel SA) | `feat/<name>-task-<id>` | `feat/hooks-restore-workflow-task-p2-json` |
| Worktree path      | `.worktrees/<slug>`     | `.worktrees/feat-hooks-p2-task-json`       |

## Workflow

### 1. Bootstrap epic worktree

默认 `settings.worktree.forbidCreateFromMain: true` 时，**在 main/master checkout 上执行任意 `git worktree add` 都会被 branch-gate 拒绝**（含 `-b feat/x`）。须先离开 main：

```bash
git checkout -b feat/<name>
git worktree add .worktrees/feat-<name>-task-json -b feat/<name>-task-json
```

Orchestrator 留在 main checkout（只读协调）；所有写入在 task worktree 内完成。Epic 集成分支 `feat/<name>` 可在上述 checkout 后继续添加更多 task worktree。

若要允许从 main 建 worktree，在 `quality-gate.yaml` 设置 `settings.worktree.forbidCreateFromMain: false`。

### 2. TodoWrite first

Create ≥1 todo before any Read/Write. Explore items include plan reads, e.g.「读取 .cursor/plans/xxx.md」.

### 3. Add parallel task worktrees

从 epic 分支 checkout（非 main/master）添加 task worktree：

```bash
git checkout feat/<name>
git worktree add .worktrees/feat-<name>-task-json -b feat/<name>-task-json
git worktree add .worktrees/feat-<name>-task-scripts -b feat/<name>-task-scripts
```

When **≥2 pending todos**, dispatch **≥2 background Tasks** in the same turn.

### 4. Dispatch subagents

| Todo kind | Subagent                           | Worktree               |
| --------- | ---------------------------------- | ---------------------- |
| explore   | `Task(background, explore)`        | any                    |
| impl      | `Task(background, generalPurpose)` | matching task worktree |
| ship      | `Task(background, shell)` ship-sa  | task or session wt     |

Orchestrator must **not** Read/Write or run `git commit` / `git push` / `git merge`.

### 5. Integrator merge template

After a task branch is done, merge into the parent epic (not main):

```bash
cd .worktrees/feat-<name>
git merge --no-ff feat/<name>-task-<id> -m "merge: integrate task <id> into epic"
```

Only **integrator-sa** or **merge-sa** background subagents may run merge commands.

### 6. Remove task worktree after merge

Once `feat/<name>-task-<id>` is merged into `feat/<name>`:

```bash
git worktree remove .worktrees/feat-<name>-task-<id>
```

`branch-delete-gate` allows remove when the task branch is merged into its parent epic (not only main/master).

### 7. Ship loop

When impl todos are complete, ship via GitHub PR（not local merge）.

> **策略**：禁止本地 `git merge <feat>` 到 main/master（有 remote 且 `forcePrWhenRemote` 开启时由 `block-dangerous-commands` 的 `checkMergeNoFfRequired` 拦截）。无 remote 或开关关闭时仍可本地 merge（需 `--no-ff` 触发 pre-merge-commit 门）。

1. **ship-sa** `Task(background, shell)` — in the task worktree:
   1. `git add` + `git commit` until pre-commit gate is green（conventional commit message: `feat`/`fix`/`docs`/`test`/`chore`...）
   2. `git push -u origin feat/<name>`
   3. Watch CI until all green: `gh run watch`（或 `gh pr checks --watch --fail-fast`）。CI 失败时停止并上报——orchestrator 将 dispatch `ci-fixer-sa`，修复后 re-push/re-watch。
   4. Create PR: `gh pr create --base main --head feat/<name> --title "<type>: <desc>" --body "<summary>"`

2. **merge-sa** `Task(background, generalPurpose)` — after PR created and CI green:
   1. Merge the PR: `gh pr merge --squash --delete-branch`（默认 `--squash`，除非 repo 约定另有要求；保留 `--delete-branch` 清理远程 feat 分支）
   2. Sync local main: `git checkout main && git pull --ff-only`
   3. Redeploy hooks locally: `./scripts/link-cursor-hooks-global.sh && ./scripts/install-cursor-yingmi-hooks.sh`
   4. Tell the user to restart Cursor so the IDE reloads hook configuration.

3. **ci-fixer-sa** — fix CI/gate failures and retry（由 orchestrator 在 ship-sa 上报 CI 失败后 dispatch）。

Stop is blocked until `ship_status=merge_ok`（PR 已合并）. Read the hook reason and dispatch the matching background SA.

## Examples

### Example: two parallel impl tasks

```text
TodoWrite: [explore plan, impl JSON hook, impl scripts hook]
Task(background, explore) → read plan
Task(background, generalPurpose) @ .worktrees/feat-x-task-json
Task(background, generalPurpose) @ .worktrees/feat-x-task-scripts
```

### Example: integrator after task completion

```text
Task(background, generalPurpose) integrator-sa @ .worktrees/feat-x
  → git merge --no-ff feat/x-task-json
  → git worktree remove .worktrees/feat-x-task-json
```

### Example: phase ship

```text
Task(background, shell) ship-sa @ task wt
  → git commit until pre-commit green
  → git push -u origin feat/x
  → gh run watch (CI green)  # 失败则 orchestrator dispatch ci-fixer-sa
  → gh pr create --base main --head feat/x
Task(background, generalPurpose) merge-sa
  → gh pr merge --squash --delete-branch
  → git checkout main && git pull --ff-only
  → ./scripts/link-cursor-hooks-global.sh && ./scripts/install-cursor-yingmi-hooks.sh
  → tell user to restart Cursor
```

## Anti-patterns

- Orchestrator directly `Read` plan files (use explore SA)
- Orchestrator `git commit` / `git push` (use ship-sa / merge-sa)
- Removing task worktree before merge into parent epic
- Single background Task when ≥2 todos are pending
