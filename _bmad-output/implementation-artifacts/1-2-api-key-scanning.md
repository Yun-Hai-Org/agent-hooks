# Story 1.2: 新增 API 密钥扫描模式

Status: review

## Story

As a **Claude Code 开发者**,
I want **protect-secrets 在 PreToolUse 阶段扫描写入文件中的 API 密钥（OpenAI、Anthropic、HuggingFace、Discord、Telegram、Vault 等 8 种模式）**,
So that **AI 写入代码时不慎泄露的 API 密钥在保存时被自动发现并阻止**.

## Acceptance Criteria

1. **Given** Claude 写入的文件包含 `sk-` 开头的 OpenAI API 密钥
   **When** protect-secrets PreToolUse 检测触发（Write/Edit）
   **Then** 钩子返回 deny 决策，输出检测报告
   **And** 报告列出密钥类型（如 `openai-api-key`）和位置

2. **Given** Claude 写入的文件包含 `sk-ant-` 开头的 Anthropic API 密钥
   **When** protect-secrets PreToolUse 检测触发
   **Then** 钩子返回 deny 决策，阻止写入

3. **Given** Claude 写入的文件包含 8 种支持的 API 密钥之一（OpenAI、Anthropic、HuggingFace、Discord、Telegram、Vault 等）
   **When** protect-secrets 内容扫描触发
   **Then** 输出检测报告，列出发现的密钥类型
   **And** 共新增 8 个 API 密钥模式

4. **Given** 文件内容不包含任何 API 密钥模式
   **When** protect-secrets 内容扫描触发
   **Then** 静默通过，不输出报告

5. **Given** 文件排除列表中的测试文件包含 API 密钥
   **When** protect-secrets 内容扫描触发
   **Then** 不检测排除列表中的文件（应为 false positive 允许）

## Tasks / Subtasks

- [x] **Task 1: 分析现有 CONTENT_PATTERNS 并设计新增 8 个 API 密钥模式 (AC: #1-#3)**
  - [x] 确认现有 CONTENT_PATTERNS 已覆盖的密钥类型（AWS、GitHub、GitLab、Slack、Stripe、Google 等）
  - [x] 设计 8 个新 API 密钥正则模式：
    - OpenAI API Key: `sk-proj-` 或 `sk-org-` 或 `sk-` 开头的模式
    - Anthropic API Key: `sk-ant-` 开头
    - HuggingFace Token: `hf_` 开头
    - Discord Bot Token: `[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}`
    - Telegram Bot Token: `[0-9]+:[A-Za-z0-9_-]{35,}`
    - HashiCorp Vault Token: `hvs\.[A-Za-z0-9_-]+` 或 `hvb\.[A-Za-z0-9_-]+`
    - Datadog API Key: `[0-9a-f]{32}`（匹配 datadog 上下文）
    - PagerDuty Token: `p\d{2}_[A-Za-z0-9]{20,}`

- [x] **Task 2: 在 protect-secrets.js 的 CONTENT_PATTERNS 数组新增 API 密钥模式 (AC: #1-#3)**
  - [x] 添加 OpenAI API Key 模式（`sk-proj-` / `sk-org-` / 通用 `sk-` 但排除 `sk-ant-`）
  - [x] 添加 Anthropic API Key 模式（`sk-ant-`）
  - [x] 添加 HuggingFace Token 模式（`hf_`）
  - [x] 添加 Discord Bot Token 模式
  - [x] 添加 Telegram Bot Token 模式
  - [x] 添加 HashiCorp Vault Token 模式
  - [x] 添加 Datadog API Key 模式
  - [x] 添加 PagerDuty Token 模式
  - [x] 所有模式使用 CRITICAL 级别

- [x] **Task 3: 编写测试用例 (AC: #1-#5)**
  - [x] 为每个新增 API 密钥模式编写正例测试（应被检测）
  - [x] 为排除列表中的文件编写反例测试（应跳过）
  - [x] 验证 checkContent 集成正常工作
  - [x] 验证 check 集成（Write/Edit 完整流程）

- [x] **Task 4: 运行全量测试确认无回归 (AC: #5)**
  - [x] `bun test .claude/hooks/__tests__/protect-secrets.test.js`
  - [x] `bun test .claude/hooks/__tests__/`

## Dev Notes

- **目标文件**: `.claude/hooks/protect-secrets.js`
- **测试文件**: `.claude/hooks/__tests__/protect-secrets.test.js`
- **模式库位置**: protect-secrets.js 的 `CONTENT_PATTERNS` 数组（第 298-401 行）
- **关键函数**: `checkContent()` — 内容扫描，`check()` — 完整调度
- **已有 CONTENT_PATTERNS**: 当前包含 19 条规则（信用卡、AWS、GitHub、GitLab、Slack、Stripe、Google、SendGrid、PEM 私钥、通用 API Key、密码、数据库连接、npm token、Bearer token）
- **新增量**: 8 条新的 API 密钥模式，使 CONTENT_PATTERNS 总数达到 27+ 条
- **安全级别**: 所有 API 密钥模式使用 CRITICAL，匹配 FR8 的 95%+ 检测率要求

### 新增 API 密钥模式设计

| #   | 平台            | 模式 ID              | 正则                                                         | 说明                                          |
| --- | --------------- | -------------------- | ------------------------------------------------------------ | --------------------------------------------- | ------------------------------- |
| 1   | OpenAI          | `openai-api-key`     | `sk-proj-[A-Za-z0-9]{20,}`                                   | OpenAI Project API Key                        |
| 2   | OpenAI          | `openai-org-key`     | `sk-org-[A-Za-z0-9]{20,}`                                    | OpenAI Organization API Key                   |
| 3   | Anthropic       | `anthropic-api-key`  | `sk-ant-[A-Za-z0-9]{32,}`                                    | Anthropic API Key                             |
| 4   | HuggingFace     | `huggingface-token`  | `hf_[A-Za-z0-9]{20,}`                                        | HuggingFace Access Token                      |
| 5   | Discord         | `discord-bot-token`  | `[MN][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}` | Discord Bot Token                             |
| 6   | Telegram        | `telegram-bot-token` | `[0-9]{8,10}:[A-Za-z0-9_-]{35,}`                             | Telegram Bot Token                            |
| 7   | HashiCorp Vault | `vault-token`        | `hvs\.[A-Za-z0-9_-]{20,}`                                    | Vault Token                                   |
| 8   | Datadog         | `datadog-api-key`    | `(datadog                                                    | dd)\_api_key['"]?\s*[:=]\s*['"]?[0-9a-f]{32}` | Datadog API Key（含上下文匹配） |
| 9   | PagerDuty       | `pagerduty-token`    | `p[dt]d_[A-Za-z0-9]{20,}`                                    | PagerDuty Token                               |
| 10  | 通用 OpenAI     | `openai-generic-key` | `sk-[A-Za-z0-9]{20,}`                                        | 通用 OpenAI 模式（排除 sk-ant）               |

注：实际可实现 8-10 种模式以覆盖更多主流平台。Epic 要求 8 种，可额外扩展 2 种。

### 测试策略

- 每个新增模式 ≥1 个正例测试（应检测到）
- 排除文件路径的 false positive 测试
- 边界值测试（过短/过长的密钥不误报）
- 集成测试（check() 函数完整流程）
- 全量回归测试确认无破坏

### 正则设计要点

- OpenAI: `sk-proj-` 和 `sk-org-` 前缀针对 project/org API key；通用 `sk-{20,}` 兜底
- Anthropic: `sk-ant-` 特殊前缀，与 OpenAI 区分
- HuggingFace: `hf_` 前缀，长度 20+
- Discord: 点分隔的三段式 base64 token
- Telegram: `数字:base64` 格式
- Vault: `hvs.` 前缀
- Datadog: 含上下文匹配，避免 32 位 hex 误报
- PagerDuty: `p*_` 前缀

### Project Structure Notes

- 所有新增模式放在 `CONTENT_PATTERNS` 数组中（protect-secrets.js）
- 不创建新文件，不改变现有函数签名
- 测试放在 `__tests__/protect-secrets.test.js` 中扩展
- Story 1.1 已完成，现有模式已包含 GitHub/AWS/GitLab/Slack/Stripe/Google/SendGrid 等

### References

- [Source: epics.md#L288-L303] Story 1.2 定义
- [Source: prd.md#FR8] PostToolUse 阶段自动扫描 API 密钥
- [Source: prd.md#P0-1] protect-secrets 增强 — 8 API 密钥扫描
- [Source: architecture.md#5] protect-secrets 模式库组织
- [Source: architecture.md#6] 测试扩展策略（≥3 用例/类别）

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (BMAD dev sub-agent)

### File List

- `.claude/hooks/protect-secrets.js` (修改 — 新增 8+ API 密钥扫描模式到 CONTENT_PATTERNS)
- `.claude/hooks/__tests__/protect-secrets.test.js` (修改 — 新增 API 密钥测试用例)

## Completion Notes

Story 1.2 是 Epic 1 的第二个任务，在 Story 1.1（敏感文件 + Terraform 保护）之后，专注于：

1. 在 protect-secrets.js 的 CONTENT_PATTERNS 中新增 8-10 个 API 密钥扫描模式
2. 覆盖 OpenAI、Anthropic、HuggingFace、Discord、Telegram、HashiCorp Vault、Datadog、PagerDuty 等平台
3. 在 PreToolUse 阶段检测写入内容中的 API 密钥，及时阻止泄露
4. 为所有新增模式编写单元测试
5. 确保排除列表中的文件不被误检
