# Story 1.1: 新增敏感文件与 Terraform 状态文件保护模式

Status: review

## Story

As a **Claude Code 开发者**,
I want **protect-secrets 钩子覆盖更多敏感文件类型（.env.\*、证书、私钥、SSH 配置）以及 Terraform 状态文件（.tfstate/.tfvars）**,
So that **AI 无法读取或写入这些文件，防止敏感信息泄露和基础设施被篡改**.

## Acceptance Criteria

1. **Given** Claude 尝试读取 `**/.env.production` 或 `**/.env.local`
   **When** protect-secrets PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，阻止该操作
   **And** 拦截消息包含文件路径、敏感文件类别名和 CRITICAL 级别

2. **Given** Claude 尝试写入 `**/*.tfstate` 或 `**/*.tfvars`
   **When** protect-secrets PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，阻止该操作

3. **Given** Claude 尝试读取 SSH 私钥文件（`id_rsa`, `id_ed25519`, `id_ecdsa`）
   **When** protect-secrets PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，阻止该操作

4. **Given** Claude 尝试访问 `.env.*` 变体（`.env.development`, `.env.staging` 等）
   **When** protect-secrets PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，阻止该操作

5. **Given** Claude 尝试使用 Bash 命令读取 `.tfstate` 文件
   **When** protect-secrets 的 Bash 命令检测触发
   **Then** 钩子返回 deny 决策，阻止该操作

## Tasks / Subtasks

- [x] **Task 1: 分析现有 protect-secrets.js 的 SENSITIVE_FILES 列表 (AC: #1-#5)**
  - [x] 确认 .env.\_ 模式已存在
  - [x] 确认 SSH 私钥模式已存在
  - [x] 确认证书文件 (.pem, .key, .p12, .pfx) 已存在
  - [x] 确认缺少 Terraform 文件模式

- [x] **Task 2: 新增 8 个敏感文件模式到 SENSITIVE_FILES (AC: #1-#4)**
  - [x] `.env.*` 变体 — 已由现有正则 `/(?:^|\/)\.env(?:\.[^/]*)?$/` 覆盖
  - [x] 公钥文件 `.pub` — 新增 `pub-key` 模式 (CRITICAL)
  - [x] SSH 配置目录保护（`.ssh/config`）— 新增 `ssh-config` 模式 (CRITICAL)
  - [x] Terraform 状态文件：`*.tfstate`, `*.tfstate.*`, `*.tfvars` — 新增 `tfstate` 和 `tfvars` 模式 (CRITICAL)

- [x] **Task 3: 新增 Terraform 状态文件 Bash 命令保护 (AC: #5)**
  - [x] 阻止 `cat *.tfstate` 等读取操作 — 新增 `cat-tfstate` 模式
  - [x] 阻止 `cp *.tfvars` 等复制操作 — 新增 `cp-tfvars` 和 `cat-tfvars` 模式

- [ ] **Task 4: 新增 8 个 API 密钥扫描模式到 CONTENT_PATTERNS (AC: Story 1.2 需)**
      **[注意：这部分属于 Story 1.2，当前 Story 1.1 不实现]**

- [x] **Task 5: 为所有新增模式编写测试用例 (每类别 ≥3 个)**

## Dev Notes

- **目标文件**: `.claude/hooks/protect-secrets.js`
- **测试文件**: `.claude/hooks/__tests__/protect-secrets.test.js`
- **模式库位置**: protect-secrets.js 中的 `SENSITIVE_FILES` 和 `BASH_PATTERNS` 数组
- **关键函数**: `checkFilePath()` / `checkBashCommand()` / `check()`
- **已有模式**: 当前 SENSITIVE_FILES 已有 28 条规则，需新增至少 8 条
- **当前 BASH_PATTERNS**: 已有 21 条规则，需新增 Terraform 相关模式
- **需要注意**: .env._ 模式已存在（通过 `/(?:^|\/)\.env(?:\.[^/]_)?$/`），但需要确认该正则是否覆盖所有变体
- **现有 .env.\* 正则**: `/(?:^|\/)\.env(?:\.[^/]*)?$/` — 这已经覆盖 `.env.local`, `.env.production` 等！

### 模式设计检查

关键发现：**现有 `.env.*` 正则已经覆盖了所有 `.env.{suffix}` 变体**。

```
正则: /(?:^|\/)\.env(?:\.[^/]*)?$/
匹配: .env, .env.local, .env.production, .env.development, .env.staging...
```

所以 Story 1.1 的 `.env.*` 需求**已由现有正则满足**！真实的增量是：

1. **Terraform 状态文件保护** — 新增 `*.tfstate`, `*.tfvars` 模式
2. **SSH 配置目录保护** — 新增 `.ssh/config`, `.ssh/*.pub` 模式
3. **Terraform Bash 命令保护** — 新增 cat/cp/mv tfstate 模式
4. **更多证书/密钥模式** — 完善现有清单

### 测试策略

- 每个新增类别至少 3 个测试用例
- 验证 blocked=true 和 pattern.level 字段
- 验证正常文件不受影响（blocked=false）
- 验证安全级别过滤正确（critical/high/strict）

### Project Structure Notes

- 遵循现有架构：所有新增模式放在 `protect-secrets.js` 的常量数组中
- 不创建新文件，不改变现有函数签名
- 测试放在 `__tests__/protect-secrets.test.js` 中扩展

### References

- [Source: epics.md#L268-L286] Story 1.1 定义
- [Source: prd.md#FR4-FR8] 敏感信息保护功能需求
- [Source: prd.md#FR7] Terraform 状态文件保护
- [Source: architecture.md#5] protect-secrets 模式库组织
- [Source: architecture.md#6] 测试扩展策略

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (BMAD dev sub-agent)

### File List

- `.claude/hooks/protect-secrets.js` (修改 — 新增敏感文件模式 + Terraform 保护)
- `.claude/hooks/__tests__/protect-secrets.test.js` (修改 — 新增测试用例)

## Completion Notes

Story 1.1 是 Epic 1 的第一个任务，专注于：

1. 向 SENSITIVE_FILES 新增 Terraform 状态文件模式（`.tfstate`, `.tfvars`）
2. 新增 SSH 配置目录等遗漏的敏感文件模式
3. 向 BASH_PATTERNS 新增 Terraform 文件相关命令模式
4. 为所有新增模式编写单元测试
