---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
  - '_bmad-output/planning-artifacts/research/technical-claude-code-hooks-research-2026-06-03.md'
workflowType: 'architecture'
project_name: '20260531-hooks'
user_name: 'Zhangwm'
date: '2026-06-08'
status: 'complete'
completedAt: '2026-06-08'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (40 项，涵盖 7 大类别):**

| 类别           | FR 编号   | 数量 | 架构影响                                    |
| -------------- | --------- | ---- | ------------------------------------------- |
| 危险命令防护   | FR1-FR3   | 3    | PreToolUse 拦截器扩展                       |
| 敏感信息保护   | FR4-FR8   | 5    | protect-secrets 模式库增强 + Terraform 保护 |
| 代码质量校验   | FR9-FR17  | 9    | post-write-lint 新增 5 个校验器             |
| Git 工作流安全 | FR18-FR25 | 8    | commit-gate 扩展 + merge-gate 全量扫描      |
| 配置管理       | FR26-FR30 | 5    | settings.json + CLAUDE.md + 命名约定        |
| 用户反馈与通知 | FR31-FR34 | 4    | Notification 钩子 + 日志系统                |
| 钩子扩展性     | FR35-FR40 | 6    | 新事件类型 + stdin/stdout 协议              |

**非功能需求 (38 项):**

- **性能 (NFR1-NFR5)**: PostToolUse <5s, 二进制工具 <100ms/文件, SessionStart <2s, 内存 <256MB
- **安全 (NFR6-NFR10)**: 敏感文件 100% 检测率, API 密钥 95%+, 危险命令 100% 阻止, 零漏报
- **集成 (NFR11-NFR14)**: Claude Code 协议兼容, 配置向后兼容, JSONL 日志
- **可靠性 (NFR15-NFR18)**: fail-open 策略, 优雅降级, 99.9% 一致性
- **工具严格度 (NFR19-NFR23)**: Semgrep/Trivy/ESLint/Ruff 全部严格模式
- **Gitignore 兼容 (NFR24-NFR26)**: post-write-lint/merge-gate 跳过 git 忽略文件, protect-secrets 不受影响
- **全局模式 (NFR33-NFR38)**: 支持全局钩子 + 项目级钩子共存, 相对路径配置

### 项目架构全景

当前已实现的 **四门安全架构**：

```
                    ┌─────────────────────────────────────────────────┐
                    │            Claude Code 工具调用链路              │
                    └─────────────────────────────────────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
     ┌──────────────┤    写入门 (PreToolUse)        ├──────────────┐
     │              │ - block-dangerous-commands    │              │
     │              │ - branch-gate                 │              │
     │              │ - protect-secrets             │              │
     │              └───────────────┬───────────────┘              │
     │                              │                              │
     │              ┌───────────────▼───────────────┐              │
     │              │    工具执行 (Bash/Edit/Write)  │              │
     │              └───────────────┬───────────────┘              │
     │                              │                              │
     │              ┌───────────────▼───────────────┐              │
     │              │    快速门 (PostToolUse)        │              │
     │              │ - post-write-lint (+5 校验)    │      P1 新增 │
     │              │ - auto-stage                   │              │
     │              └───────────────┬───────────────┘              │
     │                              │                              │
     │              ┌───────────────▼───────────────┐              │
     │    P1 新增   │    提交门 (PreToolUse commit)  │              │
     │  ┌───────────┤ - commit-gate                 │              │
     │  │           └───────────────┬───────────────┘              │
     │  │                           │                              │
     │  │           ┌───────────────▼───────────────┐              │
     │  │           │    合并门 (PreToolUse merge)   │              │
     │  │           │ - merge-gate                   │              │
     │  │           └───────────────────────────────┘              │
     │  │
     │  │  P1 新增钩子事件:
     │  │  ┌──────────────────────────────────────────────────┐
     │  ├──│ SessionStart    → 健康检查 (工具可用性探测)       │
     │  ├──│ UserPromptSubmit → 敏感词过滤                     │
     │  └──│ Notification    → 安全事件通知 (企业微信/飞书)    │
     │     └──────────────────────────────────────────────────┘
```

### 本轮 (P0+P1) 技术架构增量

**P0 增量（安全加固）：**

| 组件               | 变更                                                                        | 范围       |
| ------------------ | --------------------------------------------------------------------------- | ---------- |
| protect-secrets.js | 新增 8 敏感文件模式 + 8 API 密钥扫描 + 5 Bash 拦截 + Terraform 状态文件保护 | 写入门扩展 |
| post-write-lint.js | 新增 lintShell() + lintDockerfile()                                         | 快速门扩展 |

**P1 增量（质量提升 + 新事件）：**

| 组件                          | 变更                                                              | 范围         |
| ----------------------------- | ----------------------------------------------------------------- | ------------ |
| post-write-lint.js            | 新增 lintToml() + lintSql() + lintCss() + JSON/YAML Schema 增强   | 快速门扩展   |
| security-orchestrator.js      | 新增消息格式化工具函数 (formatBlock/formatReport/formatHealth 等) | 共享模块增强 |
| 新文件: session-start.js      | SessionStart 健康检查钩子                                         | 新事件类型   |
| 新文件: user-prompt-filter.js | UserPromptSubmit 敏感词过滤钩子                                   | 新事件类型   |
| 新文件: notification-hook.js  | Notification 安全事件通知钩子                                     | 新事件类型   |
| settings.json                 | 相对路径改造 + 新事件配置                                         | 全局模式支持 |

### 技术约束与依赖

1. **运行时约束**: 所有钩子通过 Bun 执行 (ESM 模块), 冷启动 <5ms
2. **工具依赖 (fail-open)**: shellcheck, shfmt, hadolint, taplo, SQLFluff, stylelint, prettier, check-jsonschema — 未安装时跳过
3. **协议约束**: 严格遵循 Claude Code stdin/stdout JSON 协议
4. **向后兼容**: 现有 settings.json 配置无破坏性变更
5. **跨平台**: macOS/Linux 支持
6. **纯 CLI**: 无图形界面, 所有交互通过终端文本输出

### Decision Priority Analysis

**已确定的决策（无需重新决策）：**

| 决策        | 确定值                       | 依据                  |
| ----------- | ---------------------------- | --------------------- |
| 钩子运行时  | Bun (JavaScript/ESM)         | 现有架构，冷启动 ~5ms |
| 钩子协议    | stdin/stdout JSON            | Claude Code 原生协议  |
| 配置格式    | JSON (.claude/settings.json) | 现有架构              |
| 测试框架    | Bun 内置测试 (bun:test)      | 现有架构              |
| 代码质量    | ESLint strict + Prettier     | 现有架构              |
| Python 工具 | uv run (ruff/pyright)        | 现有架构              |
| 安全扫描    | Semgrep + Trivy              | 现有架构              |
| 死代码检测  | Knip                         | 现有架构              |

**需决策的关键项：**

| 优先级 | 决策                       | 关系到                |
| ------ | -------------------------- | --------------------- |
| 关键   | 新校验器架构模式           | P0-2~P0-4, P1-1~P1-5  |
| 关键   | 新钩子事件实现             | P1-6~P1-8             |
| 关键   | 消息格式化标准             | UX 设计的统一输出规范 |
| 关键   | 全局模式路径改造           | NFR33~NFR38           |
| 重要   | 测试扩展策略               | 测试覆盖目标          |
| 重要   | protect-secrets 模式库组织 | P0-1 安全模式增强     |

### Starter Template Evaluation

#### Primary Technology Domain

CLI 工具增强 (Brownfield) — 存量项目，技术栈已确定

#### 项目类型分析

本项目为 **存量增强 (Brownfield)** 项目，技术栈在设计之初已经确定：

| 维度            | 已确定的技术                                  | 依据                                  |
| --------------- | --------------------------------------------- | ------------------------------------- |
| **钩子运行时**  | Bun (JavaScript/ESM)                          | 冷启动 ~5ms，内建 JSON 处理，异步并发 |
| **钩子配置**    | JSON (.claude/settings.json)                  | Claude Code 原生协议                  |
| **Python 工具** | uv run                                        | ruff/pyright/SQLFluff                 |
| **二进制工具**  | shellcheck, hadolint, shfmt, taplo, stylelint | 编译型工具，启动 <2ms                 |
| **测试框架**    | Bun 内置测试 (bun:test)                       | 无需额外依赖                          |
| **代码检查**    | ESLint strict + Prettier                      | JS 代码质量                           |
| **死代码检测**  | Knip                                          | JS 应用                               |
| **安全扫描**    | Semgrep + Trivy                               | 全量安全扫描                          |

#### 结论

**不适用新 Starter 模板。** 本项目的架构骨架（四门安全架构、7 个钩子脚本、共享 orchestrator 模块）已经存在且经过验证。P0/P1 阶段是在此基础上扩展校验器、增强安全模式和添加新钩子事件类型，所有新增代码继承现有架构模式。

### 跨领域关注点

1. **渐进式信任模型**: PostToolUse(报告) → commit(阻断) → merge(全量扫描) — 三级力度逐级递增, 统一的严重度分级 (CRITICAL/HIGH/MEDIUM/LOW)
2. **fail-open 策略**: 外部工具未安装时静默跳过, 钩子崩溃优雅降级, 永不阻塞用户工作流
3. **全局模式支持**: 全局钩子 (~/.claude/hooks/) 和项目级钩子 (.claude/hooks/) 共存, 项目级配置优先
4. **gitignore 兼容**: post-write-lint 和 merge-gate 跳过 git 忽略文件, protect-secrets 不受影响
5. **统一消息格式**: 所有钩子使用 `[emoji] [hook-name] 描述 (级别)` 格式, ANSI 颜色 + 表情符号双重编码
6. **日志可审计**: 所有拦截记录到 ~/.claude/hooks-logs/, JSONL 格式

## Core Architectural Decisions

### 1. 新校验器架构模式（验证器插件模式）

**决策:** 在 `post-write-lint.js` 中采用 switch/case 路由 + 独立 lint 函数的模式扩展新校验器。

**架构模式：**

```
post-write-lint.js (主入口)
├── lintShell()       — P0: shellcheck + shfmt (新增)
├── lintDockerfile()  — P0: hadolint (新增)
├── lintJSON()        — P1: prettier + check-jsonschema (增强)
├── lintYAML()        — P1: prettier + check-jsonschema (增强)
├── lintToml()        — P1: taplo (新增)
├── lintSql()         — P1: SQLFluff (新增)
├── lintCss()         — P1: stylelint + prettier (新增)
└── lintJavaScript()  — existing: ESLint + Prettier (已有)
```

**Rationale:**

- 保持文件碎片最小化（所有校验器在同一个文件，避免 7 个钩子脚本 → 14+ 个）
- switch/case 按文件扩展名分发，清晰、可测试
- 每个 lint 函数遵循统一签名：`async function lintXxx(filePath) → boolean`
- 工具未安装时 fail-open 跳过（调用 `checkToolAvailable()`）

**文件类型 → 校验器映射：**

| 扩展名/文件名                            | 校验器函数       | 工具                        | 阶段     |
| ---------------------------------------- | ---------------- | --------------------------- | -------- |
| .sh, .bash, .zsh                         | lintShell()      | shellcheck + shfmt          | P0       |
| Dockerfile, Containerfile, \*.dockerfile | lintDockerfile() | hadolint                    | P0       |
| .json                                    | lintJSON()       | prettier + check-jsonschema | P1(增强) |
| .yaml, .yml                              | lintYAML()       | prettier + check-jsonschema | P1(增强) |
| .toml                                    | lintToml()       | taplo                       | P1       |
| .sql                                     | lintSql()        | SQLFluff                    | P1       |
| .css, .scss, .less                       | lintCss()        | stylelint + prettier        | P1       |

### 2. 新钩子事件实现

**2.1 SessionStart — 健康检查钩子**

| 属性          | 决策                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **实现方式**  | 新文件 `.claude/hooks/session-start.js`                               |
| **配置注册**  | `.claude/settings.json` 的 `SessionStart` 事件列表                    |
| **输出格式**  | `ℹ️ [session-start] 🟢 shellcheck ✔ hadolint ✔ SQLFluff ❌（未安装）` |
| **检查内容**  | 扫描 tools 列表中所有二进制工具的可执行性                             |
| **缓存**      | 结果缓存到内存，同一会话不重复检查                                    |
| **超时**      | 2秒超时 (NFR3)                                                        |
| **fail-open** | 即使检查失败也不阻止会话启动                                          |

**2.2 UserPromptSubmit — 敏感词过滤**

| 属性          | 决策                                                             |
| ------------- | ---------------------------------------------------------------- |
| **实现方式**  | 新文件 `.claude/hooks/user-prompt-filter.js`                     |
| **配置注册**  | `.claude/settings.json` 的 `UserPromptSubmit` 事件列表           |
| **匹配模式**  | 正则库（API 密钥模式、敏感路径、凭证关键词）                     |
| **输出**      | 匹配时拒绝：`🛡️ [user-prompt-filter] 提示中含有敏感信息，已阻止` |
| **fail-open** | 钩子崩溃时允许提示通过（不阻塞用户输入）                         |
| **误报控制**  | 精确匹配优先，宁可漏报不可误报                                   |

**2.3 Notification — 安全事件通知**

| 属性         | 决策                                                    |
| ------------ | ------------------------------------------------------- |
| **实现方式** | 新文件 `.claude/hooks/notification-hook.js`             |
| **配置注册** | `.claude/settings.json` 的 `Notification` 事件列表      |
| **通知渠道** | 企业微信 Webhook（P1）/ 飞书 Webhook（P1）/ Slack（P2） |
| **触发条件** | 其他 PreToolUse 钩子产生 deny 决策时                    |
| **消息格式** | 适配企业微信 Markdown 卡片                              |
| **频控**     | 同一事件 5 分钟内不重复发送                             |

### 3. 消息格式化标准（遵循 UX 设计规范）

在 `security-orchestrator.js` 中新增统一的消息格式化工具函数：

```javascript
// 工具函数签名
colorize(text, color); // ANSI 颜色封装，内置 NO_COLOR 检测
formatBlock(hookName, reason, severity); // 🚫 阻断消息
formatReport(hookName, summary, results); // 🛡️ 扫描报告
formatLint(hookName, file, line, rule, desc); // ⚠️ lint 警告
formatPass(hookName, summary); // ✅ 通过消息
formatInfo(hookName, message); // ℹ️ 信息消息
formatSkip(hookName, tool); // ⏭️ 跳过消息
truncate(text, maxWidth); // 消息截断
```

**严重度-颜色映射：**

| 严重度   | ANSI 颜色  | Emoji   |
| -------- | ---------- | ------- |
| CRITICAL | Red + Bold | 🚫      |
| HIGH     | Red        | 🚫      |
| MEDIUM   | Yellow     | ⚠️ / 🛡️ |
| LOW      | Blue       | ℹ️      |
| PASS     | Green      | ✅      |
| SKIP     | Gray       | ⏭️      |

### 4. 全局模式路径改造

**settings.json 变更（相对路径化）：**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "bun .claude/hooks/block-dangerous-commands.js" }]
      }
    ]
  }
}
```

| 文件                         | 改动                            | 优先级 |
| ---------------------------- | ------------------------------- | ------ | --- | --- |
| settings.json                | 绝对路径 → 相对路径             | P0     |
| merge-gate.js                | 测试路径 `import.meta.url` 定位 | P0     |
| 所有 git 命令                | 显式传入 cwd 参数               | P1     |
| protect-secrets.js           | HOME fallback `                 |        | ''` | P1  |
| commit-gate.js/merge-gate.js | 工具链检测增强 (项目类型感知)   | P1     |

### 5. protect-secrets 模式库组织

采用**按类别分组**的方式组织正则模式，而非单一列表：

| 类别                            | 条目数   | 示例                                                 |
| ------------------------------- | -------- | ---------------------------------------------------- |
| **敏感文件** (SENSITIVE_FILES)  | 8 (新增) | `**/.env*`, `**/*.pem`, `**/*.tfstate`               |
| **API 密钥** (API_KEY_PATTERNS) | 8 (新增) | OpenAI `sk-...`, Anthropic `sk-ant-...`, HuggingFace |
| **Bash 拦截** (DANGEROUS_BASH)  | 5 (新增) | `rm -rf /`, `dd if=/dev/zero`, fork bomb             |
| **Terraform 状态** (TF_PROTECT) | 2 (新增) | `**/*.tfstate`, `**/*.tfvars`                        |

**匹配优先级：** Terraform > API 密钥 > 敏感文件 > Bash 命令

### 6. 测试扩展策略

| 校验器                     | 测试文件                   | 最低用例数 |
| -------------------------- | -------------------------- | ---------- |
| lintShell()                | post-write-lint.test.js    | ≥3         |
| lintDockerfile()           | post-write-lint.test.js    | ≥3         |
| lintToml()                 | post-write-lint.test.js    | ≥3         |
| lintSql()                  | post-write-lint.test.js    | ≥3         |
| lintCss()                  | post-write-lint.test.js    | ≥3         |
| protect-secrets (新增模式) | protect-secrets.test.js    | ≥3/类别    |
| session-start.js           | session-start.test.js      | ≥3         |
| user-prompt-filter.js      | user-prompt-filter.test.js | ≥3         |
| notification-hook.js       | notification-hook.test.js  | ≥3         |

**P0 测试目标:** 130+ 总用例 (当前 115 + 15)
**P1 测试目标:** 150+ 总用例 (130 + 20+)

### Decision Impact Analysis

**Implementation Sequence (优先 P0, 次优 P1):**

```
P0-1: protect-secrets 增强 ─────────────────────┐
P0-2: Shell 校验 (lintShell) ────┤              │
P0-3: Dockerfile 校验 ───────────┼── 可并行开发 ┤
P0-4: Terraform 保护 ────────────┘              │
P0-5: settings.json 相对路径改造 ────────────────┘
                                                    ▼
P1-1: JSON/YAML Schema 增强 ────┐
P1-2: TOML 校验 ────────────────┤
P1-3: SQL 校验 ─────────────────┼── 可并行开发
P1-4: CSS 校验 ─────────────────┤
P1-5: session-start.js ─────────┤
P1-6: user-prompt-filter.js ────┤
P1-7: notification-hook.js ─────┘
```

**Cross-Component Dependencies:**

- 所有新校验器依赖 `security-orchestrator.js` 的 `checkToolAvailable()` 和 `execCommand()`
- session-start.js 和 notification-hook.js 依赖 `settings.json` 的新事件配置
- 全局模式改造 (`settings.json` 相对路径) 影响所有钩子的执行

## Implementation Patterns & Consistency Rules

### 命名模式

| 领域           | 约定                                         | 示例                                                   |
| -------------- | -------------------------------------------- | ------------------------------------------------------ |
| **校验器函数** | `lint<FileType>()` — PascalCase              | `lintShell()`, `lintDockerfile()`, `lintToml()`        |
| **钩子文件**   | kebab-case                                   | `session-start.js`, `user-prompt-filter.js`            |
| **测试文件**   | `<hook-name>.test.js`                        | `session-start.test.js`                                |
| **测试函数**   | `describe('<hook-name>')` + `it('行为描述')` | `describe('lintShell')`, `it('安装时校验 shell 脚本')` |
| **变量**       | camelCase                                    | `filePath`, `toolName`, `permissionDecision`           |
| **常量**       | UPPER_SNAKE_CASE                             | `SENSITIVE_FILES`, `API_KEY_PATTERNS`, `SEVERITY`      |
| **JSON 字段**  | snake_case (Claude Code 协议)                | `tool_name`, `tool_input`, `permission_decision`       |
| **环境变量**   | UPPER_SNAKE_CASE                             | `NO_COLOR`, `HOOK_LANG`                                |

### 结构模式

**文件组织（现有约定，延续）：**

```
.claude/
├── hooks/
│   ├── <hook-name>.js          # 钩子脚本（所有校验器在 post-write-lint.js）
│   ├── security-orchestrator.js # 共享模块
│   └── __tests__/
│       ├── <hook-name>.test.js  # 测试文件
│       └── helpers.js           # 测试辅助函数
└── settings.json               # 钩子配置
```

**以下规则 AI Agent 必须遵守：**

1. **禁止创建新的钩子脚本文件**（除非是新事件类型如 session-start.js）
2. **校验器统一放在 `post-write-lint.js`** 中，通过 switch/case 路由
3. **测试文件统一放在 `__tests__/` 目录**，使用 `helpers.js` 中的辅助函数
4. **共享逻辑放在 `security-orchestrator.js`** 中（如 `checkToolAvailable()`, `execCommand()`）

### 通信模式

**钩子协议 (stdin/stdout JSON):**

| 方面               | 约定                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| **输入格式**       | `{ tool_name, tool_input, session_id, cwd, permission_mode }`                                            |
| **输出格式(允许)** | `{}`                                                                                                     |
| **输出格式(拒绝)** | `{ hookSpecificOutput: { hookEventName, permissionDecision: "deny", permissionDecisionReason: "..." } }` |
| **日志格式**       | `{ timestamp, event, tool, result, reason, session_id }` (JSONL)                                         |
| **严重度**         | 使用 `SEVERITY` 枚举: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`                                                |

### 处理模式

| 模式          | 规则                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| **fail-open** | 工具未安装时 `checkToolAvailable()` 返回 false ⇒ 跳过校验，输出 `⏭️` 信息 |
| **优雅降级**  | 钩子内部异常捕获 ⇒ console.error + 返回 `{}`（放行），不阻塞工作流        |
| **超时控制**  | 所有外部命令执行使用 `withTimeout(cmd, ms)`，默认 10s 超时                |
| **日志输出**  | 所有决策（通过/拒绝/跳过/异常）写入 JSONL 日志                            |
| **错误信息**  | 拒绝时附带清晰的 `permissionDecisionReason`，包含原因 + 严重度 + 修复建议 |

### AI Agent 强制约束

1. **必须**使用 `security-orchestrator.js` 提供的工具函数（不重复实现 `execCommand`、`checkToolAvailable`、`formatBlock` 等）
2. **必须**遵循 `DECISION` / `SEVERITY` 枚举常量的命名
3. **必须**为每个新校验器/新钩子编写 ≥3 个测试用例
4. **必须**使用 `helpers.js` 中的 `createHookInput()`、`expectDeny()`、`expectAllow()` 等测试辅助函数
5. **必须**在函数/文件中处理 fail-open 路径（工具未安装、超时、异常）

### 正确示例与反模式

**✅ 正确的校验器实现：**

```javascript
async function lintShell(filePath) {
  if (!checkToolAvailable('shellcheck')) {
    log(HOOK_NAME, 'shellcheck', 'SKIP', 'shellcheck 未安装');
    return true; // fail-open
  }
  await execCommand(`shfmt -w "${filePath}"`);
  const result = await execCommand(`shellcheck "${filePath}"`);
  if (!result.success) {
    console.error(formatLint(HOOK_NAME, filePath, '', 'SC????', result.stdout));
    return false;
  }
  return true;
}
```

**❌ 反模式：**

- 使用 `python`/`pip` 而非 `uv`/`uv run` (违反工具限制)
- 创建独立的校验器文件（应集中在 `post-write-lint.js`）
- 在校验器中直接写 `console.error(formatBlock())`（PostToolUse 只报告不阻断）
- 使用 `node` 而非 `bun` 执行脚本

## Project Structure & Boundaries

### 完整项目目录结构

```
20260531-hooks/
├── .claude/
│   ├── CLAUDE.md                          # 项目安全指令
│   ├── rules/
│   │   └── external-content-security.md   # 外部内容安全规则
│   ├── settings.json                      # 钩子配置（中心枢纽）
│   ├── hooks/
│   │   ├── security-orchestrator.js       # 共享模块（决策引擎、工具函数）
│   │   ├── block-dangerous-commands.js    # [写入门] 危险命令拦截
│   │   ├── branch-gate.js                # [写入门] 分支保护
│   │   ├── protect-secrets.js            # [写入门] 敏感文件保护（P0 增强）
│   │   ├── post-write-lint.js            # [快速门] 代码质量校验（P0+P1 扩展）
│   │   ├── auto-stage.js                 # [快速门] 自动 git add
│   │   ├── commit-gate.js                # [提交门] 提交扫描
│   │   ├── merge-gate.js                 # [合并门] 全量安全扫描
│   │   ├── session-start.js              # [新事件] SessionStart 健康检查 — P1 NEW
│   │   ├── user-prompt-filter.js         # [新事件] UserPromptSubmit 敏感词过滤 — P1 NEW
│   │   └── notification-hook.js          # [新事件] Notification 安全通知 — P1 NEW
│   │   └── __tests__/
│   │       ├── helpers.js                # 测试辅助函数
│   │       ├── security-orchestrator.test.js
│   │       ├── block-dangerous-commands.test.js
│   │       ├── branch-gate.test.js
│   │       ├── protect-secrets.test.js
│   │       ├── post-write-lint.test.js   # P0+P1 扩展测试
│   │       ├── auto-stage.test.js
│   │       ├── commit-gate.test.js
│   │       ├── merge-gate.test.js
│   │       ├── session-start.test.js     # P1 NEW
│   │       ├── user-prompt-filter.test.js # P1 NEW
│   │       └── notification-hook.test.js  # P1 NEW
│   └── hooks-logs/                       # 运行时生成的日志目录
│       └── *.jsonl                       # JSONL 格式日志文件
├── _bmad/                                # BMAD 流程工具
├── _bmad-output/                         # BMAD 输出目录
│   ├── planning-artifacts/
│   │   ├── prd.md
│   │   ├── ux-design-specification.md
│   │   ├── architecture.md
│   │   └── research/
│   │       └── technical-claude-code-hooks-research-2026-06-03.md
│   └── build-status.json
├── package.json                          # Bun 项目配置
├── bun.lock                              # Bun 锁定文件
├── eslint.config.js                      # ESLint 配置（strict 预设）
├── .prettierrc                           # Prettier 配置
├── pyproject.toml                        # Python/Ruff 配置
├── pyrightconfig.json                    # Pyright 配置
├── .markdownlint.json                    # markdownlint 配置
├── knip.json                             # Knip 死代码检测配置
├── .gitignore
└── CLAUDE.md                             # 项目说明（已存在）
```

### 新增/变更文件清单

| 文件                                                 | 变更类型 | 阶段  | 说明                        |
| ---------------------------------------------------- | -------- | ----- | --------------------------- |
| `.claude/hooks/protect-secrets.js`                   | 修改     | P0    | 新增 8+8+5 模式             |
| `.claude/hooks/post-write-lint.js`                   | 修改     | P0+P1 | 新增 5 个校验器函数         |
| `.claude/hooks/security-orchestrator.js`             | 修改     | P0+P1 | 新增消息格式化函数          |
| `.claude/hooks/session-start.js`                     | 新增     | P1    | SessionStart 健康检查       |
| `.claude/hooks/user-prompt-filter.js`                | 新增     | P1    | UserPromptSubmit 敏感词过滤 |
| `.claude/hooks/notification-hook.js`                 | 新增     | P1    | Notification 安全事件通知   |
| `.claude/hooks/__tests__/post-write-lint.test.js`    | 修改     | P0+P1 | 新增校验器测试用例          |
| `.claude/hooks/__tests__/protect-secrets.test.js`    | 修改     | P0    | 新增模式测试用例            |
| `.claude/hooks/__tests__/session-start.test.js`      | 新增     | P1    | 新钩子测试                  |
| `.claude/hooks/__tests__/user-prompt-filter.test.js` | 新增     | P1    | 新钩子测试                  |
| `.claude/hooks/__tests__/notification-hook.test.js`  | 新增     | P1    | 新钩子测试                  |
| `.claude/settings.json`                              | 修改     | P0+P1 | 相对路径 + 新事件配置       |

### 架构边界

**钩子事件边界：**

| 事件类型                     | 钩子文件                    | 输入                               | 输出行为           |
| ---------------------------- | --------------------------- | ---------------------------------- | ------------------ |
| PreToolUse (Bash)            | block-dangerous-commands.js | `tool_name: "Bash"`                | deny 或 allow      |
| PreToolUse (Bash/Edit/Write) | branch-gate.js              | `tool_input.command` / `file_path` | deny 或 allow      |
| PreToolUse (Bash)            | protect-secrets.js          | `tool_input.command` (含文件路径)  | deny 或 allow      |
| PreToolUse (Edit/Write)      | protect-secrets.js          | `tool_input.file_path`             | deny 或 allow      |
| PostToolUse (Edit/Write)     | post-write-lint.js          | `tool_input.file_path`             | 输出警告（不阻断） |
| PostToolUse (Edit/Write)     | auto-stage.js               | `tool_input.file_path`             | 自动 git add       |
| PreToolUse (git commit)      | commit-gate.js              | `tool_input.command`               | deny 或 allow      |
| PreToolUse (git merge)       | merge-gate.js               | `tool_input.command`               | deny 或 allow      |
| SessionStart                 | session-start.js            | `{}`                               | 输出健康报告       |
| UserPromptSubmit             | user-prompt-filter.js       | `prompt_text`                      | deny 或 allow      |
| Notification                 | notification-hook.js        | `notification_type, message`       | Webhook 通知       |

### 需求 → 结构映射

| 需求范畴                     | 实现文件                              | 说明                    |
| ---------------------------- | ------------------------------------- | ----------------------- |
| FR1-FR3 (危险命令)           | block-dangerous-commands.js           | 现有，P0 无变更         |
| FR4-FR8 (敏感信息)           | protect-secrets.js                    | P0 增强模式库           |
| FR9-FR17 (代码质量)          | post-write-lint.js                    | P0+P1 新增 5 校验器     |
| FR18-FR25 (Git 安全)         | commit-gate.js, merge-gate.js         | 现有，P1 工具链检测增强 |
| FR31 (即时反馈)              | security-orchestrator.js (格式化函数) | P0+P1 新增统一消息格式  |
| FR32 (通知)                  | notification-hook.js                  | P1 新增                 |
| FR33 (日志)                  | ~/.claude/hooks-logs/\*.jsonl         | 现有                    |
| FR34 (健康检查)              | session-start.js                      | P1 新增                 |
| FR35 (Notification 事件)     | notification-hook.js                  | P1 新增                 |
| FR36 (UserPromptSubmit 事件) | user-prompt-filter.js                 | P1 新增                 |
| FR37 (SessionStart 事件)     | session-start.js                      | P1 新增                 |
| NFR33-NFR38 (全局模式)       | settings.json + 所有钩子              | P0+P1 逐步改造          |

## Architecture Validation Results

### Coherence Validation ✅

**决策兼容性：** 所有技术选择完全兼容，无矛盾决策。Bun/JavaScript 运行时、各二进制工具（shellcheck/hadolint/taplo/SQLFluff/stylelint）均独立运行，无冲突依赖。

**模式一致性：** 新校验器模式沿用现有 `post-write-lint.js` switch/case 架构，不存在模式冲突。消息格式化统一使用 `security-orchestrator.js` 的新增工具函数。

**结构对齐：** 所有 P0/P1 新增文件在 `.claude/hooks/` 和 `__tests__/` 目录内，与现有结构一致，无新目录引入。

### Requirements Coverage Validation ✅

**功能需求覆盖 (40/40 = 100%):**

| 类别           | FR 编号   | 架构覆盖                                      | 状态 |
| -------------- | --------- | --------------------------------------------- | ---- |
| 危险命令防护   | FR1-FR3   | block-dangerous-commands.js (现有)            | ✅   |
| 敏感信息保护   | FR4-FR8   | protect-secrets.js (P0 增强)                  | ✅   |
| 代码质量校验   | FR9-FR17  | post-write-lint.js (P0+P1 新增 5 校验器)      | ✅   |
| Git 工作流安全 | FR18-FR25 | commit-gate.js + merge-gate.js (现有)         | ✅   |
| 配置管理       | FR26-FR30 | settings.json + CLAUDE.md (现有)              | ✅   |
| 用户反馈与通知 | FR31-FR34 | 格式化函数 + notification-hook.js (P1) + 日志 | ✅   |
| 钩子扩展性     | FR35-FR40 | 3 个新钩子文件 + 现有协议                     | ✅   |

**非功能需求覆盖 (38/38 = 100%):**

| NFR 类别                     | 数量 | 架构覆盖                              | 状态 |
| ---------------------------- | ---- | ------------------------------------- | ---- |
| 性能 (NFR1-NFR5)             | 5    | fail-open + 超时控制 + 缓存策略       | ✅   |
| 安全 (NFR6-NFR10)            | 5    | protect-secrets 精准匹配 + 零漏报策略 | ✅   |
| 集成 (NFR11-NFR14)           | 4    | 严格协议对齐 + 向后兼容               | ✅   |
| 可靠性 (NFR15-NFR18)         | 4    | fail-open + 优雅降级模式              | ✅   |
| 工具严格度 (NFR19-NFR23)     | 5    | 沿用现有配置                          | ✅   |
| Gitignore 兼容 (NFR24-NFR26) | 3    | isGitIgnored() 工具函数               | ✅   |
| 全局模式 (NFR33-NFR38)       | 6    | 相对路径改造 + cwd 传递               | ✅   |

### Implementation Readiness Validation ✅

**决策完整性：** 所有关键决策均已记录（校验器架构、新钩子事件、消息格式化、全局模式、protect-secrets 模式库组织、测试策略）。

**结构完整性：** 完整的目录结构定义，所有 P0/P1 新增文件路径均已指定。

**模式完整性：** 命名约定、文件组织、钩子协议、fail-open 策略、错误处理均有明确定义和示例。

### Gap Analysis Results

| 缺口                                     | 优先级 | 说明                              | 处理                                      |
| ---------------------------------------- | ------ | --------------------------------- | ----------------------------------------- |
| 未定义 JSON Schema 文件位置              | P1     | check-jsonschema 需要 schema 文件 | 可在实现时确定（放在 `.claude/schemas/`） |
| 未指定企业微信/飞书 Webhook URL 配置方式 | P1     | notification-hook.js 需要配置     | 通过 settings.json 的 env 字段传入        |
| SessionStart 缓存机制未细化              | P1     | 同一会话不重复检查的实现方式      | 使用模块级变量缓存，实现时决定            |

### Architecture Completeness Checklist

**✅ Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**

- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**

- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**

- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** HIGH

**Key Strengths:**

- 所有架构决策基于已验证的现有架构（Brownfield 优势）
- P0/P1 增量完全兼容当前四门安全架构
- 新校验器遵循已验证的 switch/case + 独立函数模式
- 新钩子事件类型与 Claude Code 协议原生兼容
- 所有决策均有 PRD 和 UX 规范作为依据

**Areas for Future Enhancement:**

- JSON Schema 文件位置约定（P1 实现时定）
- Webhook URL 配置方式（P1 实现时定）
- 配置驱动架构（P2）

### Implementation Handoff

**AI Agent Guidelines:**

- 所有架构决策已在本文档中完整记录
- 实现时严格遵循命名约定和文件组织约定
- 新校验器统一放在 `post-write-lint.js` 中，通过 switch/case 路由
- 新事件类型创建独立的钩子文件（`session-start.js`, `user-prompt-filter.js`, `notification-hook.js`）
- 测试用例使用 `helpers.js` 中的工具函数，最低 3 个/校验器

**Implementation Priority (P0 first, then P1):**

1. P0-1: protect-secrets 模式库增强
2. P0-2: lintShell() Shell 校验 (shellcheck + shfmt)
3. P0-3: lintDockerfile() Dockerfile 校验 (hadolint)
4. P0-4: Terraform 状态文件保护
5. P0-5: settings.json 相对路径改造
6. P1-1~P1-5: 文件类型校验器扩展 (JSON/YAML/TOML/SQL/CSS)
7. P1-6~P1-8: 新钩子事件 (SessionStart/UserPromptSubmit/Notification)
