# Story 6.1: settings.json 相对路径与全局模式改造

Status: done

## Story

As a **Claude Code 开发者**,
I want **settings.json 使用相对路径，支持全局钩子和项目级钩子共存**,
so that **钩子系统可迁移到全局 `~/.claude/hooks/`，项目级配置优先**.

## Acceptance Criteria

1. **Given** settings.json 中所有 hook command 使用相对路径
   **When** Claude Code 加载配置
   **Then** 路径格式为 `bun .claude/hooks/xxx.js`（非绝对路径）
   **And** merge-gate.js 使用 `import.meta.url` 定位 `__tests__/` 目录

2. **Given** 全局钩子和项目级钩子同时存在
   **When** 两者冲突
   **Then** 项目级配置优先

3. **Given** 钩子在全局模式下运行
   **When** 项目无本地钩子
   **Then** 自动回退到 `~/.claude/hooks/` 目录

## Tasks / Subtasks

- [x] Task 1: security-orchestrator.js 导出共享路径常量 (AC: #1)
  - [x] 使用 import.meta.url 计算 HOOKS_DIR
  - [x] 导出 HOOKS_DIR, TESTS_DIR, LOG_DIR
- [x] Task 2: 创建 resolve-hook-path.js 全局模式解析器 (AC: #2, #3)
  - [x] 项目级 hooks 优先
  - [x] 回退到 ~/.claude/hooks/
- [x] Task 3: 更新 settings.json 使用 resolve-hook-path.js (AC: #1, #2)
- [x] Task 4: 钩子文件使用共享路径常量 (AC: #1)
  - [x] 替换所有本地 LOG_DIR 为导入
- [x] Task 5: 新增测试用例 (AC: #1, #2, #3)
- [x] Task 6: 运行全量测试验证无回归

## Dev Notes

### 现有代码分析

**settings.json**: 已使用相对路径 `bun .claude/hooks/xxx.js` ✅
**merge-gate.js**: 已使用 `import.meta.url` 定位 `__tests__/` ✅
**protect-secrets.js**: 已有 `process.env.HOME || ''` fallback ✅

**重复代码问题**:

- 6 个钩子文件各自定义 `LOG_DIR = join(process.env.HOME || '', '.claude', 'hooks-logs')`
- 6 个钩子文件各自实现 `log()` 函数
- 应统一使用 security-orchestrator.js 的共享实现

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.1]
- [Source: _bmad-output/planning-artifacts/prd.md#Global Mode Support]
- [Source: _bmad-output/planning-artifacts/architecture.md#全局模式路径改造]

## Dev Agent Record

### File List

- `.claude/settings.json` - 更新所有 hook command 使用 resolve-hook-path.js
- `.claude/hooks/security-orchestrator.js` - 新增 HOOKS_DIR, TESTS_DIR, LOG_DIR 共享路径常量
- `.claude/hooks/resolve-hook-path.js` - **新增** 全局模式路径解析器
- `.claude/hooks/merge-gate.js` - 移除本地 import.meta.url 逻辑，使用共享 TESTS_DIR
- `.claude/hooks/block-dangerous-commands.js` - 导入共享 LOG_DIR
- `.claude/hooks/branch-gate.js` - 导入共享 LOG_DIR
- `.claude/hooks/protect-secrets.js` - 导入共享 LOG_DIR
- `.claude/hooks/auto-stage.js` - 导入共享 LOG_DIR
- `.claude/hooks/post-write-lint.js` - 导入共享 LOG_DIR
- `.claude/hooks/session-start.js` - 导入共享 LOG_DIR
- `.claude/hooks/__tests__/resolve-hook-path.test.js` - **新增** 路径解析器和共享常量测试

### Completion Notes

- 750 测试全部通过，0 回归
- settings.json 路径已全部使用 resolve-hook-path.js 包装
- 共享路径常量基于 import.meta.url，支持全局模式和项目级模式
- Code review 发现并修复了 2 个测试质量问题
