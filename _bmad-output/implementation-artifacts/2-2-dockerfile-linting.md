# Story 2.2: Dockerfile 校验（lintDockerfile）

Status: done

## Story

As a **Claude Code 开发者**,
I want **保存 Dockerfile 或 Containerfile 后自动运行 hadolint**,
So that **AI 编写的 Dockerfile 遵循安全最佳实践**.

## Acceptance Criteria

1. **Given** Claude 写入名为 `Dockerfile`、`Containerfile` 或 `*.dockerfile` 的文件
   **When** post-write-lint PostToolUse 钩子触发
   **Then** 运行 hadolint 进行静态分析
   **And** 安全相关规则（如 DL3006、DL3023、DL3025）标记为 HIGH 级别

2. **Given** hadolint 未安装
   **When** lintDockerfile() 调用 checkToolAvailable('hadolint') 返回 false
   **Then** 函数返回 true（fail-open），输出 ⏭️ 跳过消息

## Tasks / Subtasks

- [x] Task 1: 增强 lintDockerfile() 函数 (AC: #1, #2)
  - [x] Subtask 1.1: fail-open 模式（execCommand('which hadolint') 与文件内统一约定一致）
  - [x] Subtask 1.2: 解析 hadolint 输出，安全规则标记 HIGH 级别（HADOLINT_SECURITY_RULES 映射 + Object.freeze）
  - [x] Subtask 1.3: 输出格式与 lintShell 保持一致（emoji + 状态描述 + 严重级别排序）
- [x] Task 2: 新增功能测试用例 (AC: #1, #2)
  - [x] Subtask 2.1: Dockerfile 文件路由测试（Dockerfile/Containerfile/\*.dockerfile）
  - [x] Subtask 2.2: hadolint 未安装时 fail-open 测试
  - [x] Subtask 2.3: hadolint 检测到问题时返回 false
  - [x] Subtask 2.4: 安全规则输出包含 DL 编号和 HIGH 级别
- [x] Task 3: 运行测试验证（103 pass / 0 fail，562 全量测试通过）
- [x] Task 4: 代码审查并更新 build-status.json

## Dev Notes

### 实现要点

- lintDockerfile() 位于 `.claude/hooks/post-write-lint.js` 第 284-301 行
- 当前实现使用 `execCommand('which hadolint')` 检测工具，需改为 `checkToolAvailable` 模式
- 需要解析 hadolint 输出，识别安全规则（DL3006/DL3023/DL3025 等）并标记 HIGH
- hadolint 输出格式：`file:line col: rule-code message (severity)`
- fail-open 策略：工具未安装时跳过并返回 true，使用 ⏭️ emoji

### 架构模式

- 遵循现有 lintXXX 命名约定
- 使用 execCommand() 执行外部命令
- 安全规则分类：
  - DL3006: 始终在 FROM 中添加标签 (HIGH)
  - DL3023: COPY --from 序号不匹配 (HIGH)
  - DL3025: JSON 格式使用指令参数 (HIGH)
  - 其他 DL 规则: MEDIUM 级别

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2]
- [Source: .claude/hooks/post-write-lint.js#lintDockerfile]
- [Source: .claude/hooks/__tests__/post-write-lint.test.js]
- [Source: .claude/hooks/__tests__/post-write-lint.test.js#lintShell 功能测试 (参考模式)]

## Dev Agent Record

### Agent Model Used

MiMo-v2.5-pro

### Completion Notes List

1. 新增 `HADOLINT_SECURITY_RULES` 常量映射（14 条 HIGH + 11 条 MEDIUM），使用 `Object.freeze()` 保护
2. 新增 `getHadolintSeverity()` 函数：hadolint 原生级别 + 安全规则叠加分类（CRITICAL/HIGH/MEDIUM）
3. 新增 `parseHadolintOutput()` 函数：解析 hadolint 输出，剥离 ANSI 颜色码，支持带列号/无列号两种格式
4. 增强 `lintDockerfile()` 函数：结构化输出按严重级别排序，解析失败时优雅降级到原始输出
5. 更新 switch/case default 分支：支持 `*.dockerfile` 扩展名（`filename.endsWith('.dockerfile')`）
6. 新增 30+ 测试用例覆盖：规则映射、严重级别分类、输出解析、集成测试

### File List

- `.claude/hooks/post-write-lint.js` — 增强 lintDockerfile() + 新增辅助函数
- `.claude/hooks/__tests__/post-write-lint.test.js` — 新增 lintDockerfile 功能测试
- `_bmad-output/build-status.json` — 添加 "2.2" 到 stories_completed
- `_bmad-output/implementation-artifacts/2-2-dockerfile-linting.md` — 本文件
