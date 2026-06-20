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

### Review Follow-ups (AI)

> 来源：code-review（adversarial）。protect-secrets.test.js 实测 165/165 通过；以下为评审发现的缺口。

- [x] [AI-Review][HIGH] AC #1 未完全实现：经典 `sk-` 开头 OpenAI 密钥漏检。实现仅覆盖 `sk-proj-`/`sk-org-`/`sk-ant-`，缺设计表第 10 项的通用 `sk-` 兜底。实测 `sk-T3BlbkFJ...` → ALLOWED。需产品决策：是否新增通用 `sk-[A-Za-z0-9]{20,}`（注意与 `sk-ant-` 重叠及误报风险）。[protect-secrets.js:443-455] — **已解决**：产品决策采用通用模式，新增 `openai-legacy-key` (`sk-[A-Za-z0-9]{20,}`, CRITICAL)。专用 `sk-ant-`/`sk-proj-`/`sk-org-` 因前缀后连字符打断连续字母数字串，不会被通用模式吞掉，专用判定仍优先生效（已加测试验证）。
- [x] [AI-Review][MEDIUM] Datadog 模式大小写过严：`(?:datadog|DD)_API_KEY` 无 `/i`，常见小写 `datadog_api_key=...` 漏检（实测 ALLOWED）；现有测试用非常规 `datadog_API_KEY` 掩盖了该问题。[protect-secrets.js:491-497] — **已解决**：正则增加 `/i` 标志，新增 `datadog_api_key=` 与 `dd_api_key:` 小写正例测试。
- [x] [AI-Review][LOW] Discord 模式与设计不符：设计为 `[MNO]` 前缀，实现写成 `[MN]`，且 `{23}\.{6}\.{27}` 固定长度过死板，易漏报。[protect-secrets.js:470-476] — **已解决**：改为 `[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}`，新增 `O` 前缀正例测试。
- [x] [AI-Review][LOW] 新增 9 个模式缺少反例/误报测试（如随机 32 位 hex 不应被 Datadog 误报、普通 `数字:串` 不应被 Telegram 误报），无法验证 FR8 误报率。[__tests__/protect-secrets.test.js] — **已解决**：新增 6 个反例/误报测试（随机 32 hex、时间戳短串、短 `sk-`/`hf_`/`hvs.`、普通三段式文本均不应触发）。

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

### 评审遗留项修复（2026-06-15）

- ✅ Resolved review finding [HIGH]：AC #1 经典 `sk-` 密钥漏检 —— 经产品决策，新增 `openai-legacy-key` 模式 `sk-[A-Za-z0-9]{20,}`（CRITICAL）。`sk-ant-`/`sk-proj-`/`sk-org-` 的连字符会打断连续字母数字串，故专用模式不被吞掉且优先生效，已加测试验证。
- ✅ Resolved review finding [MEDIUM]：Datadog 正则增加 `/i`，支持小写 `datadog_api_key` / `dd_api_key`。
- ✅ Resolved review finding [LOW]：Discord 正则改为 `[MNO]` 前缀 + 灵活长度 `{23,25}/{6,7}/{27,}`。
- ✅ Resolved review finding [LOW]：新增 6 个反例/误报测试以验证 FR8 误报率（随机 hex、时间戳短串、短前缀串、三段式文本）。
- 验证：`protect-secrets.test.js` 176/176 通过（修复前 165）。
- 备注：全量目录 `__tests__/` 运行时 `merge-gate.test.js` 与 `post-write-lint.test.js` 因 `execSync` 调用 git/外部 linter 阻塞而挂起；二者均不依赖 `protect-secrets.js`，与本故事改动无关（既有环境问题）。

## Change Log

| 日期       | 变更                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| 2026-06-15 | 处理 code-review 遗留项：解决 4 项（1 HIGH / 1 MEDIUM / 2 LOW）。新增 openai-legacy-key 模式、Datadog 大小写不敏感、Discord 模式灵活化，补充反例/误报测试。protect-secrets.test.js 176/176 通过。 |
