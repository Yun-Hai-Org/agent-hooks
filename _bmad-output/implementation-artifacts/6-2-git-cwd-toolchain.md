# Story 6.2: Git 命令 cwd 显式传递与工具链检测增强

Status: done

## Story

As a **Claude Code 开发者**,
I want **所有钩子中的 git 命令显式传入 cwd 参数，工具链检测基于项目类型自动切换**,
so that **钩子在跨目录迁移时依然能正确运行**.

## Acceptance Criteria

1. **Given** 钩子执行涉及 git 命令
   **When** 调用 execCommand()
   **Then** 显式传入从 stdin 获取的 cwd 参数，而非依赖进程 cwd

2. **Given** 项目包含 package.json + bun.lock 或 pyproject.toml
   **When** 工具链检测触发
   **Then** 自动使用 bun/uv 作为对应工具运行时

3. **Given** protect-secrets.js 读取 HOME 环境变量
   **When** HOME 变量为空
   **Then** 使用 `process.env.HOME || ''` fallback

## Tasks / Subtasks

- [ ] Task 1: 新增 detectToolchain() 到 security-orchestrator.js (AC: #2)
  - [ ] 检测 package.json + bun.lock → 返回 { js: 'bun' }
  - [ ] 检测 pyproject.toml → 返回 { python: 'uv' }
- [ ] Task 2: commit-gate.js 中 git 命令传递 cwd (AC: #1)
  - [ ] getCurrentBranch(cwd) 和 getStagedFiles(cwd) 接受 cwd 参数
  - [ ] 所有 execCommand 调用传递 { cwd }
- [ ] Task 3: merge-gate.js 中 git 命令传递 cwd (AC: #1)
  - [ ] getCurrentBranch(cwd) 接受 cwd 参数
  - [ ] getGitIgnoredDirs(cwd) 接受 cwd 参数
  - [ ] runFullTests(cwd) 使用 detectToolchain() 选择工具 (AC: #2)
  - [ ] 所有 execCommand/execCommandAsync 调用传递 { cwd }
- [ ] Task 4: protect-secrets.js HOME fallback 验证 (AC: #3)
- [ ] Task 5: 新增单元测试覆盖 cwd 传递和 detectToolchain (AC: #1, #2)
- [ ] Task 6: 运行全量测试验证无回归

## Dev Notes

### 现有代码分析

**security-orchestrator.js 的 git 辅助函数已支持 cwd：**

- `isGitRepo(cwd)` - 第 238 行
- `getCurrentBranch(cwd)` - 第 250 行
- `isGitIgnored(filePath, cwd)` - 第 262 行

**commit-gate.js 问题：**

- `getCurrentBranch()` (第 41 行) - 无 cwd 参数，依赖进程 cwd
- `getStagedFiles()` (第 46 行) - 无 cwd 参数
- `checkBranch()` / `checkSensitiveFiles()` 不传递 cwd

**merge-gate.js 问题：**

- `getCurrentBranch()` (第 71 行) - 无 cwd 参数
- `getGitIgnoredDirs()` (第 43 行) - 无 cwd 参数
- `runFullTests()` (第 197 行) - 工具链检测硬编码，不基于项目类型
- 多处 `execCommand('test -f ...')` 无 cwd

**protect-secrets.js 现状：**

- 第 508 行已使用 `process.env.HOME || ''` - 已满足 AC#3

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.2]
- [Source: .claude/hooks/security-orchestrator.js#Git 辅助函数]
- [Source: .claude/hooks/commit-gate.js#getCurrentBranch/getStagedFiles]
- [Source: .claude/hooks/merge-gate.js#getCurrentBranch/runFullTests]

## Dev Agent Record

### Agent Model Used

MiMo-v2.5-pro

### Debug Log References

### Completion Notes List

### File List
