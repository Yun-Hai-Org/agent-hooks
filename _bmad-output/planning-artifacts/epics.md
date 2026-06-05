---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
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

| FR | Epic | 说明 |
|----|------|------|
| FR1-FR3 | (已有) | 危险命令基础防护 — 已实现 |
| FR4-FR6 | Epic 1 | 敏感文件保护增强 |
| FR7 | Epic 1 | Terraform 状态文件保护 |
| FR8 | Epic 1 | API 密钥内容扫描扩展 |
| FR9 | Epic 2 | Shell 脚本校验 |
| FR10 | Epic 2 | Dockerfile 校验 |
| FR11 | Epic 3 | JSON Schema 增强 |
| FR12 | Epic 3 | YAML Schema 增强 |
| FR13 | Epic 3 | TOML 校验 |
| FR14 | Epic 4 | SQL 校验 |
| FR15 | Epic 4 | CSS 校验 |
| FR16 | Epic 2-4 | 校验输出格式（贯穿各校验器） |
| FR17 | Epic 6 | 配置化启用/禁用 |
| FR18-FR25 | (已有) | Git 工作流安全 — 已实现 |
| FR26-FR30 | Epic 6 | 配置管理基础设施 |
| FR31 | (已有) | 即时反馈 — 已实现 |
| FR32 | Epic 5 | Slack/飞书通知 |
| FR33 | (已有) | JSONL 日志 — 已实现 |
| FR34 | Epic 5 | SessionStart 健康检查 |
| FR35 | Epic 5 | Notification 事件 |
| FR36 | Epic 1 | UserPromptSubmit 事件 |
| FR37 | Epic 5 | SessionStart 事件 |
| FR38-FR40 | (已有) | 协议/fail-open/渐进信任 — 已实现 |

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

## Epic Details

<!-- Repeat for each epic in epics_list (N = 1, 2, 3...) -->

## Epic {{N}}: {{epic_title_N}}

{{epic_goal_N}}

<!-- Repeat for each story (M = 1, 2, 3...) within epic N -->

### Story {{N}}.{{M}}: {{story_title_N_M}}

As a {{user_type}},
I want {{capability}},
So that {{value_benefit}}.

**Acceptance Criteria:**

<!-- for each AC on this story -->

**Given** {{precondition}}
**When** {{action}}
**Then** {{expected_outcome}}
**And** {{additional_criteria}}

<!-- End story repeat -->
