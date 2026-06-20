---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
  - '_bmad-output/planning-artifacts/research/technical-claude-code-hooks-research-2026-06-03.md'
  - '_bmad-output/brainstorming/brainstorming-session-20260601-085633.md'
---

# 20260531-hooks - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for 20260531-hooks, decomposing the requirements from the PRD, research report, and brainstorming session into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: 开发者能够阻止 AI 执行危险的 Bash 命令（如 `rm -rf`、fork bomb、`dd`）
FR2: 开发者能够看到被拦截命令的风险级别（CRITICAL/HIGH/MEDIUM/LOW）和拦截原因
FR3: 开发者能够在 PreToolUse 阶段阻止危险命令执行，防止不可逆操作
FR4: 开发者能够阻止 AI 读取敏感文件（.env、API 密钥、证书、私钥）
FR5: 开发者能够阻止 AI 写入或修改敏感文件
FR6: 开发者能够看到敏感文件访问的风险级别和拦截原因
FR7: 开发者能够保护 Terraform 状态文件（.tfstate）和变量文件（.tfvars）
FR8: 开发者能够在 PostToolUse 阶段自动扫描代码中的 API 密钥泄露（OpenAI、Anthropic、HuggingFace 等）
FR9: 开发者能够在保存 Shell 脚本（.sh/.bash）后自动校验（shellcheck + shfmt）
FR10: 开发者能够在保存 Dockerfile 后自动校验（hadolint）
FR11: 开发者能够在保存 JSON 文件后自动校验语法和 Schema（check-jsonschema）
FR12: 开发者能够在保存 YAML 文件后自动校验语法和 Schema（prettier + check-jsonschema）
FR13: 开发者能够在保存 TOML 文件后自动校验（taplo）
FR14: 开发者能够在保存 SQL 文件后自动校验（SQLFluff）
FR15: 开发者能够在保存 CSS/SCSS/LESS 文件后自动校验（stylelint + prettier）
FR16: 开发者能够看到校验失败的详细错误信息和修复建议
FR17: 开发者能够配置校验器的启用/禁用
FR18: 开发者能够在提交前自动运行安全扫描（Semgrep、Trivy）
FR19: 开发者能够在提交前自动运行代码质量检测（ESLint、Ruff）
FR20: 开发者能够在提交前自动运行死代码检测（Knip）
FR21: 开发者能够在提交时看到扫描结果摘要（通过/失败数量）
FR22: 开发者能够在提交时阻止包含安全漏洞的代码
FR23: 开发者能够在提交时阻止包含死代码的代码
FR24: 开发者能够在合并前运行完整的安全和质量检查
FR25: 开发者能够在合并时阻止不符合标准的代码
FR26: 开发者能够通过 `.claude/hooks/` 目录管理钩子脚本
FR27: 开发者能够通过 `.claude/settings.json` 配置钩子行为
FR28: 开发者能够在 CLAUDE.md 中记录钩子使用说明
FR29: 开发者能够使用 `lintXXX` 命名约定扩展校验器
FR30: 开发者能够在 `__tests__/` 目录添加钩子测试
FR31: 开发者能够在钩子触发时收到即时反馈（拦截/通过）
FR32: 开发者能够在安全事件发生时收到通知（Slack/飞书）
FR33: 开发者能够查看钩子执行日志（~/.claude/hooks-logs/）
FR34: 开发者能够在 SessionStart 时查看钩子健康状态（工具可用性检查）
FR35: 开发者能够使用 Notification 钩子事件类型
FR36: 开发者能够使用 UserPromptSubmit 钩子事件类型
FR37: 开发者能够使用 SessionStart 钩子事件类型
FR38: 开发者能够通过 stdin/stdout JSON 协议与钩子通信
FR39: 开发者能够在钩子中使用 fail-open 策略（工具未安装时跳过，不阻塞）
FR40: 开发者能够在钩子中使用渐进式信任（PostToolUse 报告 → commit 阻断 → merge 全量扫描）

### NonFunctional Requirements

NFR1: PostToolUse 钩子在 5 秒内完成（包括所有启用的验证器）
NFR2: 二进制工具执行（shellcheck、hadolint、taplo）每个文件在 100ms 内完成
NFR3: SessionStart 钩子在 2 秒内完成
NFR4: 内存使用不超过每次钩子执行 256MB
NFR5: 钩子启动时间：编译工具不超过 100ms，Bun 脚本不超过 500ms
NFR6: 100% 检测率覆盖所有定义的敏感文件模式（SENSITIVE_FILES 列表）
NFR7: 95%+ 检测率覆盖支持的 API 密钥提供商（OpenAI、Anthropic、HuggingFace、Discord、Telegram、Vault）
NFR8: 100% 阻止危险命令模式（fork bomb、rm -rf、dd 等）
NFR9: 所有钩子执行记录到 `~/.claude/hooks-logs/`，包含时间戳、事件类型、结果
NFR10: 关键安全模式零漏报（可能有误报，但绝不遗漏）
NFR11: 100% 遵守 Claude Code 钩子协议（stdin/stdout JSON 格式）
NFR12: 支持 P0/P1 范围内所有外部工具（shellcheck、shfmt、hadolint、taplo、SQLFluff、stylelint、prettier、check-jsonschema）
NFR13: 配置文件兼容性：现有 `.claude/settings.json` 格式无破坏性变更
NFR14: 日志格式兼容 JSONL schema（timestamp、event、tool、result 字段）
NFR15: 钩子使用 fail-open 策略：外部工具未安装时跳过（不阻塞）
NFR16: 钩子崩溃不阻止开发者工作流（优雅降级）
NFR17: 99.9% 的钩子行为一致性（相同输入 → 相同输出）
NFR18: 所有钩子提供清晰的错误信息和可操作的修复建议
NFR19: Semgrep 必须启用所有安全和 OWASP 规则包
NFR20: Trivy 必须启用所有扫描器（漏洞、错误配置、密钥、许可证）
NFR21: ESLint 必须使用 strict 预设，启用未使用禁用指令报告
NFR22: Ruff 必须启用 preview 模式，启用最新实验性规则
NFR24: post-write-lint 必须跳过 `.gitignore` 中的文件
NFR25: merge-gate 中 Semgrep 和 Trivy 扫描必须排除 `.gitignore` 中的目录
NFR26: protect-secrets 不应受 `.gitignore` 影响
NFR33: settings.json 必须使用相对路径以支持全局模式
NFR34: merge-gate.js 的测试目录引用必须使用 import.meta.url 相对定位
NFR35: 所有 git 命令必须显式传入 stdin 中的 cwd 字段
NFR36: protect-secrets.js 必须添加 process.env.HOME fallback
NFR37: 工具链检测必须基于项目类型（检查 package.json/pyproject.toml）
NFR38: 全局钩子和项目级钩子共存时，项目级配置优先

### Additional Requirements

**来自研究报告的技术需求：**

- 新增 8 个敏感文件模式（.tfstate、.tfvars、.git-credentials、FIDO2 SSH 密钥、wp-config.php、gradle.properties、.yarnrc.yml、docker-compose.override.yml）
- 新增 8 个 API 密钥内容扫描模式（OpenAI、Anthropic、HuggingFace、Discord、Telegram、Vault、Azure Storage、通用 PRIVATE KEY）
- 新增 5 个 Bash 拦截模式（kubectl get secret、terraform output、openssl rsa -in、base64 -d 管道、docker exec 打印环境变量）
- security-orchestrator.js 新增 isGitIgnored() 工具函数
- 配置驱动架构（P2，本轮不实现）
- 性能优化：异步 PostToolUse、增量扫描、结果缓存（P2，本轮不实现）

**来自头脑风暴的设计理念：**

- 双层安全穹顶架构（实时防护 + 交付门禁）
- 安全工具编排器
- 四阶段 Git 工作流安全门禁
- 分级阻断策略（Critical 阻断 / Warning 警告 / Info 记录）

**实现约束：**

- 运行时：Bun (JavaScript/ESM)
- 协议：Claude Code 原生 stdin/stdout JSON
- 策略：fail-open（工具未安装时跳过）
- 兼容性：向后兼容现有 `.claude/settings.json`
- 测试入口：`bun test .claude/hooks/__tests__/`

**新增校验工具汇总：**

- 编译型二进制工具（4个）：shellcheck、shfmt、hadolint、taplo
- Node.js 包（2个）：check-jsonschema、stylelint
- Python 包（1个，via uv）：SQLFluff
- 新钩子脚本（3个）：notification-hook、user-prompt-filter、session-start
- 工具函数（1个）：isGitIgnored()

### FR Coverage Map

| FR        | Epic     | 说明                             |
| --------- | -------- | -------------------------------- |
| FR1-FR3   | (已有)   | 危险命令基础防护 — 已实现        |
| FR4-FR6   | Epic 1   | 敏感文件保护增强                 |
| FR7       | Epic 1   | Terraform 状态文件保护           |
| FR8       | Epic 1   | API 密钥内容扫描扩展             |
| FR9       | Epic 2   | Shell 脚本校验                   |
| FR10      | Epic 2   | Dockerfile 校验                  |
| FR11      | Epic 3   | JSON Schema 增强                 |
| FR12      | Epic 3   | YAML Schema 增强                 |
| FR13      | Epic 3   | TOML 校验                        |
| FR14      | Epic 4   | SQL 校验                         |
| FR15      | Epic 4   | CSS 校验                         |
| FR16      | Epic 2-4 | 校验输出格式（贯穿各校验器）     |
| FR17      | Epic 6   | 配置化启用/禁用                  |
| FR18-FR25 | (已有)   | Git 工作流安全 — 已实现          |
| FR26-FR30 | Epic 6   | 配置管理基础设施                 |
| FR31      | (已有)   | 即时反馈 — 已实现                |
| FR32      | Epic 5   | Slack/飞书通知                   |
| FR33      | (已有)   | JSONL 日志 — 已实现              |
| FR34      | Epic 5   | SessionStart 健康检查            |
| FR35      | Epic 5   | Notification 事件                |
| FR36      | Epic 1   | UserPromptSubmit 事件            |
| FR37      | Epic 5   | SessionStart 事件                |
| FR38-FR40 | (已有)   | 协议/fail-open/渐进信任 — 已实现 |

## Epic List

### Epic 1: 敏感信息保护全面增强 🔴 P0

**用户获得：** 对敏感文件、API 密钥、危险 Bash 命令和提示词泄露的全方位防护

**FRs covered:** FR4, FR5, FR6, FR7, FR8, FR36

**实现内容：**

- protect-secrets.js 扩展：新增 8 个敏感文件模式（.tfstate、.tfvars、.git-credentials、FIDO2 SSH 密钥等）
- API 密钥内容扫描扩展：新增 8 个提供商（OpenAI、Anthropic、HuggingFace、Discord、Telegram、Vault、Azure Storage、通用 PRIVATE KEY）
- Bash 拦截扩展：新增 5 个模式（kubectl get secret、terraform output、openssl rsa -in 等）
- UserPromptSubmit 钩子：提示词提交时的敏感词过滤

**门归属：** 写入门（PreToolUse）+ 新增 UserPromptSubmit 事件

### Epic 2: Shell 与 Dockerfile 质量校验 🔴 P0

**用户获得：** Shell 脚本和 Dockerfile 的自动安全检查和格式化

**FRs covered:** FR9, FR10, FR16

**实现内容：**

- `lintShell()` 函数：集成 shellcheck + shfmt，覆盖 .sh/.bash/.zsh
- `lintDockerfile()` 函数：集成 hadolint，按文件名匹配 Dockerfile/Containerfile
- 清晰的错误信息和修复建议输出

**门归属：** 快速门（PostToolUse）+ 提交门（commit-gate 升级阻断）

### Epic 3: 配置文件质量守护 🟡 P1

**用户获得：** JSON/YAML/TOML 配置文件的 Schema 验证和格式化，确保配置正确性

**FRs covered:** FR11, FR12, FR13

**实现内容：**

- JSON 增强：prettier 格式化 + check-jsonschema Schema 验证
- YAML 增强：prettier 格式化 + check-jsonschema Schema 验证
- TOML 校验：`lintToml()` 集成 taplo

**门归属：** 快速门（PostToolUse）+ 提交门（commit-gate 升级阻断）

### Epic 4: 数据库与样式文件质量 🟡 P1

**用户获得：** SQL 脚本和 CSS 样式文件的自动校验，提升代码质量

**FRs covered:** FR14, FR15

**实现内容：**

- SQL 校验：`lintSql()` 集成 SQLFluff（via uv run）
- CSS 校验：`lintCss()` 集成 stylelint + prettier，覆盖 .css/.scss/.less

**门归属：** 快速门（PostToolUse）+ 提交门（commit-gate 升级阻断）

### Epic 5: 智能通知与会话健康 🟡 P1

**用户获得：** 安全事件实时通知 + 会话启动时的工具健康检查

**FRs covered:** FR32, FR34, FR35, FR37

**实现内容：**

- Notification 钩子：安全事件推送到 Slack/飞书（Webhook）
- SessionStart 钩子：钩子健康检查，探测所有校验工具可用性
- 健康状态报告输出

**门归属：** 新增独立事件（Notification + SessionStart）

### Epic 6: 基础设施现代化改造 🟡 P1

**用户获得：** 钩子系统从项目级扩展到全局，支持 .gitignore 智能跳过

**FRs covered:** FR17, FR26-FR30 + NFR24-NFR26 + NFR33-NFR38

**实现内容：**

- gitignore 兼容：security-orchestrator 新增 `isGitIgnored()` 函数
- post-write-lint / merge-gate 跳过 .gitignore 文件
- settings.json 改用相对路径，支持全局模式（~/.claude/hooks/）
- merge-gate.js 测试路径修复（import.meta.url）
- git 命令 cwd 传递 + HOME fallback
- 工具链检测增强（基于项目类型自动选择 bun/uv/npm）

**门归属：** 快速门 + 提交门 + 合并门 + 写入门（全局影响）

## Epic 依赖关系

```
Epic 1 (安全防护增强) ← 独立可交付，P0 最高优先
Epic 2 (Shell+Docker)  ← 独立可交付，P0
Epic 3 (配置文件)      ← 独立可交付，P1
Epic 4 (数据库+样式)    ← 独立可交付，P1
Epic 5 (通知+健康)     ← 独立可交付，P1
Epic 6 (基础设施)      ← 建议最后做，为所有 Epic 提供全局模式和 gitignore 支持
```

## Epic 详情

---

### Epic 1: 敏感信息保护全面增强 🔴 P0

**目标：** 增强 protect-secrets 钩子的检测能力，新增 8 个敏感文件模式、8 个 API 密钥扫描模式、5 个 Bash 危险命令拦截模式，以及 Terraform 状态文件保护。将安全覆盖从 30 条扩展到 50+ 条。

---

#### Story 1.1: 新增敏感文件与 Terraform 状态文件保护模式

As a **Claude Code 开发者**,
I want **protect-secrets 钩子覆盖更多敏感文件类型（.env.\*、证书、私钥、SSH 配置）以及 Terraform 状态文件（.tfstate/.tfvars）**,
So that **AI 无法读取或写入这些文件，防止敏感信息泄露和基础设施被篡改**.

**Acceptance Criteria:**

- **Given** Claude 尝试读取 `**/.env.production` 或 `**/.env.local`
- **When** protect-secrets PreToolUse 钩子触发
- **Then** 钩子返回 deny 决策，阻止该操作
- **And** 拦截消息包含文件路径、敏感文件类别名和 CRITICAL 级别

- **Given** Claude 尝试写入 `**/*.tfstate` 或 `**/*.tfvars`
- **When** protect-secrets PreToolUse 钩子触发
- **Then** 钩子返回 deny 决策，阻止该操作
- **And** 共新增 8 个敏感文件模式，全部有对应测试用例

---

#### Story 1.2: 新增 API 密钥扫描模式

As a **Claude Code 开发者**,
I want **protect-secrets 在 PostToolUse 阶段扫描写入文件中的 API 密钥（OpenAI、Anthropic、HuggingFace、Discord、Telegram、Vault 等 8 种模式）**,
So that **AI 写入代码时不慎泄露的 API 密钥在保存时被自动发现**.

**Acceptance Criteria:**

- **Given** Claude 写入的文件包含 `sk-` 开头或 `sk-ant-` 开头的密钥
- **When** protect-secrets 后处理扫描触发
- **Then** 输出检测报告，列出发现的密钥类型和位置
- **And** 共新增 8 个 API 密钥模式，覆盖主流 AI 平台和基础设施工具

- **Given** 文件内容不包含任何 API 密钥模式
- **When** protect-secrets 后处理扫描触发
- **Then** 静默通过，不输出报告

---

#### Story 1.3: 新增 Bash 危险命令拦截模式

As a **Claude Code 开发者**,
I want **protect-secrets 增加 5 个 Bash 危险命令拦截模式**,
So that **AI 无法执行破坏性操作**.

**Acceptance Criteria:**

- **Given** Claude 尝试执行 `rm -rf /`、`dd if=/dev/zero of=/dev/sda` 或 `:(){ :|:& };:`
- **When** protect-secrets PreToolUse 钩子触发
- **Then** 钩子返回 deny 决策，阻止该操作
- **And** 拦截消息包含风险级别 CRITICAL 和明确的拦截原因

- **Given** 共新增 5 个 Bash 危险命令模式
- **When** 测试执行
- **Then** 每个模式至少有 1 个正向测试和 1 个负向测试

---

### Epic 2: Shell 与 Dockerfile 质量校验 🔴 P0

**目标：** 在 post-write-lint.js 中新增 lintShell() 和 lintDockerfile()，支持 .sh/.bash/.zsh 的 shellcheck+shfmt 自动校验，以及 Dockerfile/Containerfile 的 hadolint 校验。

---

#### Story 2.1: Shell 脚本校验（lintShell）

As a **Claude Code 开发者**,
I want **保存 .sh/.bash/.zsh 文件后自动运行 shellcheck + shfmt**,
So that **Shell 脚本的语法错误和安全隐患在写入时就被发现和自动修复**.

**Acceptance Criteria:**

- **Given** Claude 写入 `backup.sh` 文件
- **When** post-write-lint PostToolUse 钩子触发
- **Then** 先运行 `shfmt -w` 自动格式化，再运行 `shellcheck` 静态分析
- **And** lint 输出包含文件路径、行号、规则 ID（如 SC2115）、描述和 MEDIUM 级别

- **Given** shellcheck 未安装
- **When** lintShell() 调用 checkToolAvailable('shellcheck') 返回 false
- **Then** 函数返回 true（fail-open），输出 ⏭️ 跳过消息

---

#### Story 2.2: Dockerfile 校验（lintDockerfile）

As a **Claude Code 开发者**,
I want **保存 Dockerfile 或 Containerfile 后自动运行 hadolint**,
So that **AI 编写的 Dockerfile 遵循安全最佳实践**.

**Acceptance Criteria:**

- **Given** Claude 写入名为 `Dockerfile`、`Containerfile` 或 `*.dockerfile` 的文件
- **When** post-write-lint PostToolUse 钩子触发
- **Then** 运行 hadolint 进行静态分析
- **And** 安全相关规则（如 DL3006、DL3023、DL3025）标记为 HIGH 级别

- **Given** hadolint 未安装
- **When** lintDockerfile() 调用 checkToolAvailable('hadolint') 返回 false
- **Then** 函数返回 true（fail-open），输出 ⏭️ 跳过消息

---

### Epic 3: 配置文件质量守护 🟡 P1

**目标：** 增强 JSON/YAML 的 Schema 验证能力，新增 TOML 校验，覆盖配置文件常见格式。

---

#### Story 3.1: JSON/YAML Schema 增强

As a **Claude Code 开发者**,
I want **保存 JSON/YAML 文件后自动 prettier 格式化并运行 check-jsonschema 验证**,
So that **JSON/YAML 文件格式一致且符合项目 Schema 约束**.

**Acceptance Criteria:**

- **Given** Claude 写入 `.json`、`.yaml` 或 `.yml` 文件
- **When** post-write-lint PostToolUse 钩子触发
- **Then** 运行 `prettier --write` 格式化 + `check-jsonschema` 验证
- **And** lint 输出包含文件路径、Schema 验证结果

- **Given** 对应的 Schema 文件不存在
- **When** check-jsonschema 无法找到 schema
- **Then** 仅运行 prettier 格式化，Schema 验证跳过

---

#### Story 3.2: TOML 校验（lintToml）

As a **Claude Code 开发者**,
I want **保存 .toml 文件后自动 taplo 校验**,
So that **TOML 配置文件格式正确性在写入时就被检查**.

**Acceptance Criteria:**

- **Given** Claude 写入 `.toml` 文件
- **When** post-write-lint PostToolUse 钩子触发
- **Then** 运行 `taplo format --check` 校验 TOML 格式
- **And** lint 输出包含文件路径和具体的格式问题

- **Given** taplo 未安装
- **When** lintToml() 调用 checkToolAvailable('taplo') 返回 false
- **Then** 函数返回 true（fail-open），输出 ⏭️ 跳过消息

---

### Epic 4: 数据库与样式文件质量 🟡 P1

**目标：** 新增 SQL 和 CSS 校验器，覆盖 .sql 文件的 SQLFluff 校验以及 .css/.scss/.less 文件的 stylelint + prettier 校验。

---

#### Story 4.1: SQL 校验（lintSql）

As a **Claude Code 开发者**,
I want **保存 .sql 文件后自动 SQLFluff 校验**,
So that **SQL 脚本语法正确且符合项目 SQL 风格规范**.

**Acceptance Criteria:**

- **Given** Claude 写入 `.sql` 文件
- **When** post-write-lint PostToolUse 钩子触发
- **Then** 运行 `sqlfluff lint` 进行 SQL 语法和风格校验
- **And** lint 输出包含文件路径、行号、规则 ID 和描述

- **Given** SQLFluff 未安装
- **When** lintSql() 调用 checkToolAvailable('sqlfluff') 返回 false
- **Then** 函数返回 true（fail-open），输出 ⏭️ 跳过消息

---

#### Story 4.2: CSS 校验（lintCss）

As a **Claude Code 开发者**,
I want **保存 .css/.scss/.less 文件后自动 stylelint + prettier 校验**,
So that **CSS 代码风格统一且符合项目样式规范**.

**Acceptance Criteria:**

- **Given** Claude 写入 `.css`、`.scss` 或 `.less` 文件
- **When** post-write-lint PostToolUse 钩子触发
- **Then** 运行 `prettier --write` 格式化 + `stylelint` 静态分析
- **And** lint 输出包含文件路径、行号、规则 ID 和描述

- **Given** stylelint 未安装
- **When** lintCss() 调用 checkToolAvailable('stylelint') 返回 false
- **Then** 函数返回 true（fail-open），输出 ⏭️ 跳过消息

---

### Epic 5: 智能通知与会话健康 🟡 P1

**目标：** 利用新钩子事件类型（SessionStart、UserPromptSubmit、Notification），构建完整的安全治理闭环。

---

#### Story 5.1: SessionStart 健康检查钩子

As a **Claude Code 开发者**,
I want **每次 Claude Code 启动时自动检查所有保护工具是否已安装和可用**,
So that **我知道哪些安全保护已就绪，哪些因工具未安装而不可用**.

**Acceptance Criteria:**

- **Given** Claude Code 会话启动
- **When** SessionStart 事件触发
- **Then** 运行 session-start.js 钩子，扫描所有工具的可执行性
- **And** 输出健康检查报告：`🟢 shellcheck ✔ (v0.10.0)` 或 `🔴 SQLFluff ❌（未安装）`

- **Given** 检查超时（>2秒）
- **When** 超时触发
- **Then** 优雅降级，不阻止会话启动

---

#### Story 5.2: UserPromptSubmit 敏感词过滤钩子

As a **Claude Code 开发者**,
I want **输入提示词时自动扫描是否包含 API 密钥等敏感信息**,
So that **我不小心在提示词中暴露敏感信息时被立即阻止**.

**Acceptance Criteria:**

- **Given** 用户输入的提示词包含 API 密钥模式
- **When** UserPromptSubmit 事件触发
- **Then** 钩子返回 deny 决策，阻止该提示提交
- **And** 拦截消息：`🛡️ [user-prompt-filter] 提示中含有敏感信息，已阻止`

- **Given** 钩子内部异常崩溃
- **When** 异常捕获
- **Then** 返回 allow（fail-open），不阻塞用户输入

---

#### Story 5.3: Notification 安全事件通知钩子

As a **Claude Code 开发者**,
I want **安全拦截事件发生时自动发送通知到企业微信/飞书**,
So that **团队能实时收到安全告警**.

**Acceptance Criteria:**

- **Given** 其他 PreToolUse 钩子产生 deny 决策
- **When** Notification 事件触发
- **Then** notification-hook.js 通过 Webhook 发送通知（企业微信 Markdown 卡片）

- **Given** 同一事件 5 分钟内重复触发
- **When** 频控检查
- **Then** 不重复发送通知

- **Given** Webhook URL 未配置或发送失败
- **When** 钩子执行
- **Then** 静默跳过，优雅降级，不阻塞主流程

---

### Epic 6: 基础设施现代化改造 🟡 P1

**目标：** 将钩子系统从项目级扩展到全局模式，支持 gitignore 智能跳过，路径重写为相对路径。

---

#### Story 6.1: settings.json 相对路径与全局模式改造

As a **Claude Code 开发者**,
I want **settings.json 使用相对路径，支持全局钩子和项目级钩子共存**,
So that **钩子系统可迁移到全局 `~/.claude/hooks/`，项目级配置优先**.

**Acceptance Criteria:**

- **Given** settings.json 中所有 hook command 使用相对路径
- **When** Claude Code 加载配置
- **Then** 路径格式为 `bun .claude/hooks/xxx.js`（非绝对路径）
- **And** merge-gate.js 使用 `import.meta.url` 定位 `__tests__/` 目录

- **Given** 全局钩子和项目级钩子同时存在
- **When** 两者冲突
- **Then** 项目级配置优先

---

#### Story 6.2: Git 命令 cwd 显式传递与工具链检测增强

As a **Claude Code 开发者**,
I want **所有钩子中的 git 命令显式传入 cwd 参数，工具链检测基于项目类型自动切换**,
So that **钩子在跨目录迁移时依然能正确运行**.

**Acceptance Criteria:**

- **Given** 钩子执行涉及 git 命令
- **When** 调用 execCommand()
- **Then** 显式传入从 stdin 获取的 cwd 参数，而非依赖进程 cwd

- **Given** 项目包含 package.json + bun.lock 或 pyproject.toml
- **When** 工具链检测触发
- **Then** 自动使用 bun/uv 作为对应工具运行时

- **Given** protect-secrets.js 读取 HOME 环境变量
- **When** HOME 变量为空
- **Then** 使用 `process.env.HOME || ''` fallback

---

#### Story 6.3: Gitignore 兼容性改造

As a **Claude Code 开发者**,
I want **post-write-lint 跳过 .gitignore 中的文件，merge-gate 排除 .gitignore 中的目录**,
So that **不对 git 忽略的生成文件和临时文件做无意义校验**.

**Acceptance Criteria:**

- **Given** 文件在 .gitignore 中（如 `*.log`、构建产物）
- **When** post-write-lint 校验前调用 isGitIgnored()
- **Then** 跳过该文件的校验，不输出 lint 结果

- **Given** merge-gate 执行 Semgrep 和 Trivy 扫描
- **When** 扫描命令执行
- **Then** Semgrep 添加 --exclude 标志，Trivy 添加 --skip-dirs 标志

- **Given** protect-secrets 处理 .gitignore 中的敏感文件
- **When** 文件匹配敏感文件模式
- **Then** 不受 .gitignore 影响，正常保护
