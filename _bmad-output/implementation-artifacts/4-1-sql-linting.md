# Story 4.1: SQL 校验（lintSql）

Status: done

## Story

As a **Claude Code 开发者**,
I want **保存 .sql 文件后自动 SQLFluff 校验**,
So that **SQL 脚本语法正确且符合项目 SQL 风格规范**。

## Acceptance Criteria

1. **Given** Claude 写入 `.sql` 文件
   - **When** post-write-lint PostToolUse 钩子触发
   - **Then** 运行 `sqlfluff lint` 进行 SQL 语法和风格校验
   - **And** lint 输出包含文件路径、行号、规则 ID 和描述

2. **Given** SQLFluff 未安装
   - **When** lintSql() 调用 `execCommand('which sqlfluff')` 返回 false
   - **Then** 函数返回 true（fail-open），输出 ⏭️ 跳过消息

## Tasks / Subtasks

- [x] Task 1: 实现 lintSql() 函数 (AC: #1, #2)
  - [x] Subtask 1.1: 使用 `execCommand('which sqlfluff')` 检测工具可用性
  - [x] Subtask 1.2: 实现 fail-open 策略（工具未安装时返回 true）
  - [x] Subtask 1.3: 执行 `sqlfluff lint "{filePath}" --dialect ansi`
  - [x] Subtask 1.4: 解析 sqlfluff 输出（L:行号 | P:列号 | 规则ID | 描述）
  - [x] Subtask 1.5: 输出限制为前 15 行，超出显示计数
  - [x] Subtask 1.6: 在 switch 语句中注册 'sql' case
  - [x] Subtask 1.7: 导出 lintSql 函数
- [x] Task 2: 编写 lintSql 测试用例 (AC: #1, #2)
  - [x] Subtask 2.1: 基本功能测试（合法 SQL 文件返回 true）
  - [x] Subtask 2.2: fail-open 测试（sqlfluff 未安装时返回 true）
  - [x] Subtask 2.3: SQL 语法问题检测测试
  - [x] Subtask 2.4: 不抛异常测试
  - [x] Subtask 2.5: 文件路径参数接受测试
  - [x] Subtask 2.6: 布尔值返回类型测试
  - [x] Subtask 2.7: --dialect ansi 参数验证测试
  - [x] Subtask 2.8: sqlfluff 输出格式验证测试（行号 + 规则 ID）
- [x] Task 3: 运行测试验证
- [x] Task 4: 代码审查
- [x] Task 5: 更新 build-status.json

## Dev Notes

### 实现模式

遵循现有 `lintXxx()` 函数的统一模式：
- `checkToolAvailable` → `execCommand('which sqlfluff')`
- fail-open 策略 → 工具未安装返回 `true`
- 输出格式 → 带 emoji 前缀的 console.log
- 错误输出 → 截取前 15 行，超出显示计数

### 技术决策

- **方言选择**: 使用 `--dialect ansi` 作为默认 SQL 方言（ANSI SQL 标准）
- **输出解析**: sqlfluff 输出格式为 `L:   1 | P:   1 | L003 | ...`，以 `L:` 开头的行为 lint 结果行
- **不自动修复**: SQL 文件不支持 `--fix` 自动修复（与 lintDockerfile 类似），仅报告问题

### 文件修改

- `.claude/hooks/post-write-lint.js`:
  - 新增 `lintSql()` 函数（第 582-611 行）
  - switch case 中注册 `'sql'` 扩展名（第 680-681 行）
  - export 列表中添加 `lintSql`（第 727 行）
- `.claude/hooks/__tests__/post-write-lint.test.js`:
  - 新增 `lintSql 功能测试` describe 块（第 916-1010 行）

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1]
- [Source: .claude/hooks/post-write-lint.js#lintToml] - 参考模式
- [Source: .claude/hooks/post-write-lint.js#lintDockerfile] - fail-open 参考

## Dev Agent Record

### Agent Model Used

MiMo-v2.5-pro

### Debug Log References

### Completion Notes List

- lintSql() 函数已实现，遵循 fail-open 策略
- 使用 sqlfluff lint --dialect ansi 进行 SQL 校验
- 输出解析针对 sqlfluff 的 `L: 行 | P: 列 | 规则 | 描述` 格式
- 测试用例覆盖：正常通过、fail-open、异常检测、参数验证、输出格式

### File List

- `.claude/hooks/post-write-lint.js`（修改）
- `.claude/hooks/__tests__/post-write-lint.test.js`（修改）
