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

```bash
git worktree add .worktrees/feat-<name> -b feat/<name>
```

Orchestrator stays in main checkout; all writes happen in task worktrees.

### 2. TodoWrite first

Create ≥1 todo before any Read/Write. Explore items include plan reads, e.g.「读取 .cursor/plans/xxx.md」.

### 3. Add parallel task worktrees

```bash
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

When impl todos are complete:

1. **ship-sa** — `git add` + `git commit` until pre-commit passes (`ship_status=commit_ok`)
2. **merge-sa** — merge epic into main/master + push (`ship_status=merge_ok`)
3. **ci-fixer-sa** — fix CI/gate failures and retry

Stop is blocked until `ship_status=merge_ok`. Read the hook reason and dispatch the matching background SA.

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
Task(background, shell) ship-sa → commit in task wt
Task(background, generalPurpose) merge-sa → merge feat/x into main + push
```

## Anti-patterns

- Orchestrator directly `Read` plan files (use explore SA)
- Orchestrator `git commit` / `git push` (use ship-sa / merge-sa)
- Removing task worktree before merge into parent epic
- Single background Task when ≥2 todos are pending
