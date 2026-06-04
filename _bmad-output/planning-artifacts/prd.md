---
stepsCompleted:
  [
    step-01-init,
    step-02-discovery,
    step-02b-vision,
    step-02c-executive-summary,
    step-03-success,
    step-04-journeys,
    step-05-domain,
    step-06-innovation,
    step-07-project-type,
    step-08-scoping,
    step-09-functional,
    step-10-nonfunctional,
    step-11-polish,
    step-12-complete,
  ]
inputDocuments:
  - '_bmad-output/planning-artifacts/research/technical-claude-code-hooks-research-2026-06-03.md'
  - '_bmad-output/brainstorming/brainstorming-session-20260601-085633.md'
workflowType: 'prd'
researchCount: 1
brainstormingCount: 1
briefCount: 0
projectDocsCount: 0
classification:
  projectType: developer_tool
  domain: general
  complexity: low
  projectContext: brownfield
---

# Product Requirements Document - 20260531-hooks

**Author:** Zhangwm
**Date:** 2026-06-03

---

## Executive Summary

本产品为 Claude Code CLI 工具构建一套**确定性的 AI 安全护栏体系**，通过钩子（Hooks）机制在 AI 的每次工具调用链路中插入硬性阻断检查。Claude Code 作为 AI 编程助手的能力正快速增长，它能自主执行 Bash 命令、读写文件、提交代码、管理依赖，甚至控制版本库。随着自主性的提升，AI 的每一次行动都可能带来不可预期的风险 — 而传统的信任模型（"相信 AI 不会做错事"）随着 Agent 能力的增强变得越来越不可靠。

本产品的核心理念是：**不信任 AI 的推理过程，只信任确定性的、人在回路之外的规则**。通过将安全检查外挂到 AI 推理流程之外，钩子系统提供了一道 AI 无法修改、无法绕过、无法说服的安全闸门。

当前已实现四门安全架构（写入门、快速门、提交门、合并门），覆盖 7 个 PreToolUse/PostToolUse 钩子脚本，115 个测试用例全部通过。本次增强的核心目标是：**将安全覆盖从"核心流程"扩展到"全文件生态"**，新增 Shell/Dockerfile/TOML/SQL/CSS 等文件类型的自动校验，增强 JSON/YAML 的 Schema 验证能力，补齐 protect-secrets 的密钥检测覆盖缺口，并利用 Notification、UserPromptSubmit、SessionStart 等新钩子事件类型构建完整的安全治理闭环。

### 产品差异化

**根本差异：** 传统 Git hooks、IDE 扩展、CI 管道是"人类代码检查人类代码"。本产品是"人类编写的确定性规则约束 AI 的自主行动" — 这是一种 AI 治理范式的转变。

**核心洞察：** AI 安全治理的最佳实践入口不是宏大框架或白皮书，而是一个**具体的、可运行的、可验证的工具**。从开发者工具切入，是因为开发者对"可编程的安全规则"有天然的接受度和使用场景 — 钩子脚本就是安全策略的可执行编码。

**场景价值：** 当开发者使用 Claude Code 执行复杂任务时，背后有四道（未来五道或更多）门把关。他们不需要"信任 AI 一定不会出错"，而是**知道就算 AI 出错了也会被拦住**。

## 项目分类

| 维度         | 分类                         | 说明                                               |
| ------------ | ---------------------------- | -------------------------------------------------- |
| **项目类型** | 开发者工具（Developer Tool） | CLI 钩子/插件增强型产品                            |
| **领域**     | 通用软件开发                 | 不涉及特定监管行业                                 |
| **复杂度**   | 低                           | 技术栈已确定（Bun/JS），架构模式已建立（四门安全） |
| **项目背景** | 存量增强（Brownfield）       | 在已有 7 个钩子脚本和成熟架构上扩展覆盖面和深度    |
| **目标用户** | Claude Code 开发者/团队      | 需要安全护栏约束 AI Agent 自主行为的开发者         |

---

## 成功标准

### 用户成功

| 标准           | 指标                                                         | 验证方式                                   |
| -------------- | ------------------------------------------------------------ | ------------------------------------------ |
| **阻断即安心** | 高危操作被 PreToolUse 拦截时，用户应感到"幸好有这个护栏"     | 每种拦截场景附带清晰的拦截原因和风险级别   |
| **无感校验**   | PostToolUse 代码校验不应让用户感知到明显延迟                 | 新校验器(Shell/Docker/TOML等)冷启动 <100ms |
| **覆盖无死角** | 用户能感知每种文件类型都被"看见"和"守护"                     | 写 .sql/.sh/Dockerfile 时有校验反馈        |
| **渐进式信任** | PostToolUse(报告)→commit(阻断)→merge(全量扫描)，信任逐级增强 | 三级严重程度和阻断力度逐级递增             |

### 业务成功

| 标准             | 指标                     | P0 目标  | P1 目标  |
| ---------------- | ------------------------ | -------- | -------- |
| **安全覆盖密度** | protect-secrets 敏感模式 | 30→50 条 | 50→60 条 |
| **文件类型覆盖** | 校验的扩展名数           | 12→15 种 | 15→20 种 |
| **钩子事件利用** | 使用的事件类型           | 2 种     | 2→5 种   |
| **零安全事故**   | AI 越权导致的事故        | 0        | 0        |

### 技术成功

| 标准           | 指标                   | 目标                             |
| -------------- | ---------------------- | -------------------------------- |
| **测试覆盖**   | 每个新校验器有对应单测 | ≥3 个测试用例/校验器             |
| **总测试数**   | 从 115 增长            | P0: 130+, P1: 150+               |
| **回归安全**   | 不破坏现有钩子         | CI 100% 通过                     |
| **性能不退化** | PostToolUse 总耗时     | <5 秒 (含 ruff/eslint)           |
| **向后兼容**   | 现有配置无需修改       | 新校验器默认为"检测到工具才启用" |

---

## 产品范围

### MVP（P0 - 安全加固，1-2 周）

| #    | 功能                   | 描述                                               | 工具                 |
| ---- | ---------------------- | -------------------------------------------------- | -------------------- |
| P0-1 | protect-secrets 增强   | 新增 8 敏感文件模式 + 8 API 密钥扫描 + 5 Bash 拦截 | 正则模式             |
| P0-2 | Shell 脚本校验         | 新增 lintShell()，覆盖 .sh/.bash                   | shellcheck + shfmt   |
| P0-3 | Dockerfile 校验        | 新增 lintDockerfile()，按文件名匹配                | hadolint             |
| P0-4 | Terraform 状态文件保护 | 阻止读取/写入 `**/*.tfstate` 和 `**/*.tfvars`      | protect-secrets 模式 |

### Growth（P1 - 质量提升，2-4 周）

| #    | 功能                  | 描述                                  | 工具                        |
| ---- | --------------------- | ------------------------------------- | --------------------------- |
| P1-1 | JSON 增强             | 添加 prettier 格式化 + Schema 验证    | prettier + check-jsonschema |
| P1-2 | YAML 增强             | 添加 prettier 格式化 + Schema 验证    | prettier + check-jsonschema |
| P1-3 | TOML 校验             | 新增 lintToml()                       | taplo                       |
| P1-4 | SQL 校验              | 新增 lintSql()                        | SQLFluff                    |
| P1-5 | CSS 校验              | 新增 lintCss()，覆盖 .css/.scss/.less | stylelint + prettier        |
| P1-6 | Notification 钩子     | 安全事件通知（Slack/飞书）            | Webhook                     |
| P1-7 | UserPromptSubmit 钩子 | 敏感词过滤                            | 正则模式                    |
| P1-8 | SessionStart 钩子     | 钩子健康检查                          | 工具可用性探测              |

### Future（P2 - 本轮不实现）

| 功能             | 描述                                     |
| ---------------- | ---------------------------------------- |
| 更多文件类型     | HTML/GraphQL/Protobuf/INI/Terraform 校验 |
| 配置驱动架构     | LINTERS 注册表，配置化启用/禁用          |
| 异步 PostToolUse | 非阻塞执行                               |
| 结果缓存         | 未变更文件跳过重复检查                   |
| 运维增强         | 日志轮转、指标监控                       |

### 范围边界对照

| 维度           | MVP (P0) ✅                 | Growth (P1) ✅                       | Future (P2) ❌ |
| -------------- | --------------------------- | ------------------------------------ | -------------- |
| **时间**       | 1-2 周                      | 2-4 周                               | 后续           |
| **新增校验器** | +2 个 (Shell/Dockerfile)    | +6 个 (TOML/SQL/CSS + JSON/YAML增强) | +5 个          |
| **钩子事件**   | 2 种                        | 2→5 种                               | 5→7 种         |
| **安全模式**   | +21 条 (敏感文件+密钥+Bash) | +10 条                               | +              |
| **测试用例**   | 130+                        | 150+                                 | 180+           |
| **核心价值**   | 安全全覆盖                  | 质量自动化                           | 生态可扩展     |

---

## 用户旅程

### 用户画像：张伟 — 全栈开发者

**背景：** 张伟，32 岁，全栈开发者，在一家 SaaS 创业公司负责后端和基础设施。他最近开始使用 Claude Code 来加速日常开发，从写 API 到部署脚本，Claude 帮他省了大量时间。但有一件事让他不安 — Claude 太"能干了"，有时候会直接修改生产配置文件，甚至有一次差点把 `.env` 文件提交到了 GitHub。

**目标：** 用 Claude Code 全速开发，同时确保 AI 不会越过安全边界。

**障碍：** Claude Code 的默认行为是"只要能执行就执行"，没有内置的安全护栏。张伟需要一套自己可以配置、可以信任的安全规则。

---

### 旅程 1：从"信任 AI"到"信任护栏"（觉醒之旅）

**开篇场景：** 张伟刚安装好钩子系统。他让 Claude 帮他写一个部署脚本，Claude 写完之后直接尝试 `git push origin main`。屏幕上弹出一条红色消息：

```
🚫 [block-dangerous-commands] 禁止直接推送 main 分支
```

**发展：** 张伟愣了一下，然后意识到 — 这不是 Claude 在阻止他，而是他设置的钩子在工作。他之前最担心的就是 AI 不小心把未测试的代码推到生产环境，现在这道门已经自动关上了。

**高潮：** 又一次，张伟让 Claude 帮他调试一个数据库连接问题。Claude 尝试读取 `.env` 文件来获取连接字符串。屏幕上再次弹出：

```
🛡️ [protect-secrets] 禁止读取敏感文件: .env (级别: critical)
```

张伟意识到 — 如果没有这道门，Claude 可能已经把 `.env` 内容打印到了对话中，而这个对话可能被记录或共享。他感到的不是"被限制"，而是"被保护"。

**解决：** 张伟开始信任这套系统。他不再每次盯着 Claude 的每个操作，因为他知道 — 危险的、不可逆的操作会被自动拦截。他的精力从"监控 AI"回到了"使用 AI 提高效率"。

**本旅程揭示的能力需求：**

- 危险命令拦截的即时反馈（清晰的拦截原因 + 风险级别）
- 敏感文件路径的全面覆盖
- 拦截消息需要让用户一秒理解"为什么要拦截"和"这个拦截保护了我什么"

---

### 旅程 2：写 Shell 脚本被"救"回来（错误预防之旅）

**开篇场景：** 张伟让 Claude 写一个数据库备份脚本 `backup.sh`。Claude 很快写完了，张伟扫了一眼，看起来没问题 — `rm -rf` 清理临时文件，`pg_dump` 导出数据库，逻辑清晰。

**发展：** 但当他保存文件时，PostToolUse 钩子自动运行了 shellcheck：

```
⚠️ [post-write-lint] shellcheck 发现问题:
  backup.sh:12 — SC2115: Use "${var:?}" to ensure this never expands to /* .
  backup.sh:15 — SC2086: Double quote to prevent globbing and word splitting.
```

张伟仔细一看 — 第 12 行的 `rm -rf $TEMP_DIR/*` 中，如果 `$TEMP_DIR` 变量为空，这个命令会变成 `rm -rf /*`。这是 shellcheck 的经典规则，但张伟自己写脚本时从来不用 linter — 而 Claude 也不知道这个陷阱。

**高潮：** 张伟修正了脚本，对 Claude 说："用 `set -euo pipefail` 重写这个脚本，修复 shellcheck 的所有警告。" Claude 重新生成了脚本，这次 shellcheck 全部通过。张伟心想 — 如果没有钩子的自动校验，他可能已经在生产环境执行了那个有 bug 的脚本。

**解决：** 从此以后，张伟每次写 shell 脚本都有双重保障：shellcheck 做静态分析，shfmt 自动格式化。他不再需要手动检查脚本的安全性。

**本旅程揭示的能力需求：**

- PostToolUse 钩子对 .sh/.bash 文件的自动校验
- shellcheck 的输出需要清晰、可操作（用户能立即理解问题并修复）
- 校验失败不应阻断保存（PostToolUse 是报告模式），但应在 commit 时升级为阻断

---

### 旅程 3：Dockerfile 的安全隐患（最佳实践之旅）

**开篇场景：** 张伟让 Claude 写一个 Dockerfile 来容器化他们的 Node.js 应用。Claude 写了一个看上去挺正常的 Dockerfile：

```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "server.js"]
```

**发展：** 保存文件时，hadolint 自动运行：

```
⚠️ [post-write-lint] hadolint 发现 3 个问题:
  Dockerfile:1 — DL3006: Always tag the version of an image explicitly
  Dockerfile:3 — DL3023: COPY --chown is recommended for security
  Dockerfile:5 — DL3025: Use JSON notation for CMD and ENTRYPOINT arguments
```

**高潮：** 张伟注意到 `DL3006` — 用 `node:18` 而不是 `node:18-slim` 意味着镜像会包含不必要的工具，增加攻击面。更关键的是，没有 `USER` 指令，容器会以 root 运行。他让 Claude 按照 hadolint 的建议重写，最终得到了一个安全的、最小化的 Dockerfile。

**解决：** 张伟意识到 — AI 写 Dockerfile 时，默认会生成"能工作"的版本，而不是"安全最佳实践"的版本。hadolint 的校验填补了 AI 不知道的"行业安全规范"。

**本旅程揭示的能力需求：**

- 按文件名匹配 Dockerfile（无扩展名文件）
- hadolint 输出需要区分"安全规则"和"风格规则"
- 安全相关规则（如 root 用户）应标记为更高优先级

---

### 旅程 4：从"被保护"到"主动配置"（掌控之旅）

**开篇场景：** 张伟已经使用钩子系统两周了。他注意到每次写 `.sql` 文件时，没有任何校验反馈 — 这让他有点不安，因为他们的数据库迁移脚本经常出问题。

**发展：** 他在调研报告中看到 P1 阶段会新增 SQL 校验（SQLFluff）。同时，他发现团队最近开始使用 Terraform 管理基础设施，而 `.tfvars` 文件里可能包含数据库密码 — 这些文件目前不受保护。

**高潮：** 张伟按照 P0→P1 路线图，逐步启用了新的安全规则。他配置了 `user-prompt-filter` 钩子，在用户提交提示时扫描敏感词（防止团队成员无意中在提示中暴露 API 密钥）。他还在 `.claude/settings.json` 中配置了 Notification 钩子，当发生安全拦截时自动发送飞书通知给团队。

**解决：** 张伟不再是"被动接受保护"的用户，而是"主动配置护栏"的主人。他知道哪些门在什么时候起作用，也知道如何根据自己的项目需求调整保护级别。他把这套钩子配置分享给了团队，成为了团队中 AI 安全治理的倡导者。

**本旅程揭示的能力需求：**

- 新钩子事件（Notification、UserPromptSubmit、SessionStart）的配置和使用
- 钩子配置的文档化和可分享性（团队共享）
- 钩子拦截日志的可查询性（安全审计）
- 从"默认保护"到"自定义配置"的渐进式学习路径

---

### Journey Requirements Summary

| 旅程             | 核心需求                                     | 对应 P0/P1                  |
| ---------------- | -------------------------------------------- | --------------------------- |
| 旅程 1：觉醒     | 危险命令拦截 + 敏感文件保护 + 清晰的拦截消息 | P0-1 (protect-secrets 增强) |
| 旅程 2：错误预防 | Shell 脚本自动校验 + 可操作的 lint 输出      | P0-2 (Shell 校验)           |
| 旅程 3：最佳实践 | Dockerfile 安全校验 + 文件名匹配             | P0-3 (Dockerfile 校验)      |
| 旅程 4：掌控     | 新钩子事件 + 配置管理 + 日志查询             | P1-6~P1-8 (新钩子事件)      |
| 覆盖：质量       | JSON/YAML Schema 验证 + TOML/SQL/CSS 校验    | P1-1~P1-5 (文件类型扩展)    |

---

## 开发者工具特定需求

### Project-Type Overview

本产品为 **Claude Code CLI 的钩子增强系统**，属于开发者工具类别。核心交付形式为 JavaScript 钩子脚本（.js）+ JSON 配置文件（.claude/settings.json）。用户通过 Git 版本控制管理钩子脚本，通过 `.claude/CLAUDE.md` 维护使用文档。

### Language Matrix

| 维度            | 选择                               | 说明                                             |
| --------------- | ---------------------------------- | ------------------------------------------------ |
| **钩子运行时**  | Bun (JavaScript/ESM)               | 冷启动 ~5ms，内建 JSON 处理，异步并发            |
| **钩子配置**    | JSON (.claude/settings.json)       | Claude Code 原生协议                             |
| **Python 工具** | uv run                             | ruff/pyright/SQLFluff 等 Python 工具通过 uv 管理 |
| **二进制工具**  | shellcheck, hadolint, shfmt, taplo | 编译型工具，启动 <2ms                            |
| **文档语言**    | 中文 Markdown                      | CLAUDE.md 内嵌模式                               |

### Installation & Configuration

**新钩子的添加方式：**

1. **钩子脚本** 放置在 `.claude/hooks/` 目录，沿用现有 ESM 模块风格
2. **Hook 配置** 直接添加到 `.claude/settings.json` 对应事件类型下的 matcher 列表中
3. **工具依赖** 通过 `security-orchestrator.js` 的 `checkToolAvailable()` 探测，未安装时静默跳过（fail-open）
4. **无额外构建步骤** — Bun 直接解释执行，不需要编译

**配置示例（新增 Shell 校验钩子）：**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bun .claude/hooks/post-write-lint.js"
          }
        ]
      }
    ]
  }
}
```

新增文件类型校验在 `post-write-lint.js` 内部通过 switch/case 路由，不需要修改 `settings.json` 的匹配器列表。

### API Surface（钩子通信协议）

**输入（stdin JSON）：**

```json
{
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.sh", "content": "..." },
  "session_id": "abc-123",
  "cwd": "/path/to/project"
}
```

**输出（stdout JSON）：**

- 允许：`{}`
- 拒绝：`{ "hookSpecificOutput": { "permissionDecision": "deny", "permissionDecisionReason": "🚨 ..." } }`

**新增钩子事件类型（P1）：**

| 事件                 | 输入关键字段                   | 输出行为                      |
| -------------------- | ------------------------------ | ----------------------------- |
| **Notification**     | `notification_type`, `message` | 可向 stdout 注入自定义通知    |
| **UserPromptSubmit** | `prompt_text`                  | 可返回修改后的 prompt 或 deny |
| **SessionStart**     | 无                             | 运行环境健康检查              |

### Code Examples & Conventions

**新校验器模板（在 post-write-lint.js 中扩展）：**

```javascript
// 新增：Shell 脚本校验
async function lintShell(filePath) {
  // 按需探测工具
  if (!checkToolAvailable('shellcheck')) {
    log(HOOK_NAME, 'shellcheck', 'SKIP', 'shellcheck 未安装');
    return true; // fail-open
  }
  // 先格式化，再校验
  await execCommand(`shfmt -w "${filePath}"`);
  const result = await execCommand(`shellcheck "${filePath}"`);
  if (!result.success) {
    console.error(formatShellcheckOutput(result.stdout));
    return false;
  }
  return true;
}
```

**命名约定：**

- 函数名：`lint<FileType>()` — 如 `lintShell()`, `lintDockerfile()`, `lintToml()`
- 文件组织：所有校验器在 `post-write-lint.js` 中扩展（避免文件碎片化）
- 测试文件：`.claude/hooks/__tests__/<hook-name>.test.js`

### Migration Guide（从旧版本升级）

**P0 升级（用户无感知）：**

- `protect-secrets.js` 新增模式 — 兼容现有配置，无行为变更
- `post-write-lint.js` 新增 switch case — 对不支持的工具静默跳过
- 用户无需修改 `.claude/settings.json`

**P1 升级（需手动启用新钩子事件）：**

- Notification / UserPromptSubmit / SessionStart 作为新 hook 条目添加到 `settings.json`
- 提供配置片段，用户可复制到自己的配置中
- 不启用则无影响（向后兼容）

**测试升级：**

- `bun test ./.claude/hooks/__tests__/` 始终是唯一的测试入口
- 新增测试文件直接放入 `__tests__/` 目录

---

## 项目范围与分阶段开发

### MVP Strategy & Philosophy

**MVP Approach:** 安全增强型 MVP — 在现有四门安全架构基础上，补全关键安全缺口，实现"AI 安全治理"的核心价值承诺。

**Resource Requirements:** 单开发者，1-2 周完成 P0 阶段。

### MVP Feature Set (Phase 1 - P0)

**Core User Journeys Supported:**

- 旅程 1：觉醒之旅（被保护的安全感）
- 旅程 2：错误预防之旅（Shell 脚本被救回来）
- 旅程 3：最佳实践之旅（Dockerfile 安全隐患）

**Must-Have Capabilities:**

1. protect-secrets 增强 — 8 敏感文件模式 + 8 API 密钥扫描 + 5 Bash 拦截
2. Shell 脚本校验 — lintShell()，覆盖 .sh/.bash
3. Dockerfile 校验 — lintDockerfile()，按文件名匹配
4. Terraform 状态文件保护 — 阻止读取/写入 `**/*.tfstate` 和 `**/*.tfvars`

**可妥协项：**

- 校验输出的中文翻译（可先用英文）

### Post-MVP Features

**Phase 2 (P1 - Growth):**

1. JSON 增强 — prettier 格式化 + Schema 验证
2. YAML 增强 — prettier 格式化 + Schema 验证
3. TOML 校验 — lintToml()
4. SQL 校验 — lintSql()
5. CSS 校验 — lintCss()，覆盖 .css/.scss/.less
6. Notification 钩子 — 安全事件通知（Slack/飞书）
7. UserPromptSubmit 钩子 — 敏感词过滤
8. SessionStart 钩子 — 钩子健康检查

**Phase 3 (P2 - Future, 本轮不实现):**

- 更多文件类型（HTML/GraphQL/Protobuf/INI/Terraform）
- 配置驱动架构（LINTERS 注册表）
- 异步 PostToolUse（非阻塞执行）
- 结果缓存（未变更文件跳过重复检查）
- 运维增强（日志轮转、指标监控）

### Risk Mitigation Strategy

**Technical Risks:**

- shellcheck/hadolint 未安装 → 校验跳过
- 缓解：fail-open 策略 + SessionStart 健康检查（P1 阶段实现）

**Market Risks:**

- 新功能未被用户认可
- 缓解：每项 P0 完成后运行全量 `bun test`，确保无回归

**Resource Risks:**

- 单开发者时间不足
- 缓解：严格按 P0 checklist 执行，新想法记录到 P2 backlog

---

## 功能需求

### 危险命令防护（Dangerous Command Protection）

- **FR1**: 开发者能够阻止 AI 执行危险的 Bash 命令（如 `rm -rf`、fork bomb、`dd`）
- **FR2**: 开发者能够看到被拦截命令的风险级别（CRITICAL/HIGH/MEDIUM/LOW）和拦截原因
- **FR3**: 开发者能够在 PreToolUse 阶段阻止危险命令执行，防止不可逆操作

### 敏感信息保护（Sensitive Data Protection）

- **FR4**: 开发者能够阻止 AI 读取敏感文件（.env、API 密钥、证书、私钥）
- **FR5**: 开发者能够阻止 AI 写入或修改敏感文件
- **FR6**: 开发者能够看到敏感文件访问的风险级别和拦截原因
- **FR7**: 开发者能够保护 Terraform 状态文件（.tfstate）和变量文件（.tfvars）
- **FR8**: 开发者能够在 PostToolUse 阶段自动扫描代码中的 API 密钥泄露（OpenAI、Anthropic、HuggingFace 等）

### 代码质量校验（Code Quality Validation）

- **FR9**: 开发者能够在保存 Shell 脚本（.sh/.bash）后自动校验（shellcheck + shfmt）
- **FR10**: 开发者能够在保存 Dockerfile 后自动校验（hadolint）
- **FR11**: 开发者能够在保存 JSON 文件后自动校验语法和 Schema（check-jsonschema）
- **FR12**: 开发者能够在保存 YAML 文件后自动校验语法和 Schema（prettier + check-jsonschema）
- **FR13**: 开发者能够在保存 TOML 文件后自动校验（taplo）
- **FR14**: 开发者能够在保存 SQL 文件后自动校验（SQLFluff）
- **FR15**: 开发者能够在保存 CSS/SCSS/LESS 文件后自动校验（stylelint + prettier）
- **FR16**: 开发者能够看到校验失败的详细错误信息和修复建议
- **FR17**: 开发者能够配置校验器的启用/禁用

### Git 工作流安全（Git Workflow Security）

- **FR18**: 开发者能够在提交前自动运行安全扫描（Semgrep、Trivy）
- **FR19**: 开发者能够在提交前自动运行代码质量检测（ESLint、Ruff）
- **FR20**: 开发者能够在提交前自动运行死代码检测（Knip）
- **FR21**: 开发者能够在提交时看到扫描结果摘要（通过/失败数量）
- **FR22**: 开发者能够在提交时阻止包含安全漏洞的代码
- **FR23**: 开发者能够在提交时阻止包含死代码的代码
- **FR24**: 开发者能够在合并前运行完整的安全和质量检查
- **FR25**: 开发者能够在合并时阻止不符合标准的代码

### 配置管理（Configuration Management）

- **FR26**: 开发者能够通过 `.claude/hooks/` 目录管理钩子脚本
- **FR27**: 开发者能够通过 `.claude/settings.json` 配置钩子行为
- **FR28**: 开发者能够在 CLAUDE.md 中记录钩子使用说明
- **FR29**: 开发者能够使用 `lintXXX` 命名约定扩展校验器
- **FR30**: 开发者能够在 `__tests__/` 目录添加钩子测试

### 用户反馈与通知（User Feedback & Notifications）

- **FR31**: 开发者能够在钩子触发时收到即时反馈（拦截/通过）
- **FR32**: 开发者能够在安全事件发生时收到通知（Slack/飞书）
- **FR33**: 开发者能够查看钩子执行日志（~/.claude/hooks-logs/）
- **FR34**: 开发者能够在 SessionStart 时查看钩子健康状态（工具可用性检查）

### 钩子扩展性（Hook Extensibility）

- **FR35**: 开发者能够使用 Notification 钩子事件类型
- **FR36**: 开发者能够使用 UserPromptSubmit 钩子事件类型
- **FR37**: 开发者能够使用 SessionStart 钩子事件类型
- **FR38**: 开发者能够通过 stdin/stdout JSON 协议与钩子通信
- **FR39**: 开发者能够在钩子中使用 fail-open 策略（工具未安装时跳过，不阻塞）
- **FR40**: 开发者能够在钩子中使用渐进式信任（PostToolUse 报告 → commit 阻断 → merge 全量扫描）

---

## 非功能需求

### Performance（性能）

- **NFR1**: PostToolUse 钩子在 5 秒内完成（包括所有启用的验证器）
- **NFR2**: 二进制工具执行（shellcheck、hadolint、taplo）每个文件在 100ms 内完成
- **NFR3**: SessionStart 钩子在 2 秒内完成
- **NFR4**: 内存使用不超过每次钩子执行 256MB
- **NFR5**: 钩子启动时间：编译工具不超过 100ms，Bun 脚本不超过 500ms

### Security（安全）

- **NFR6**: 100% 检测率覆盖所有定义的敏感文件模式（SENSITIVE_FILES 列表）
- **NFR7**: 95%+ 检测率覆盖支持的 API 密钥提供商（OpenAI、Anthropic、HuggingFace、Discord、Telegram、Vault）
- **NFR8**: 100% 阻止危险命令模式（fork bomb、rm -rf、dd 等）
- **NFR9**: 所有钩子执行记录到 `~/.claude/hooks-logs/`，包含时间戳、事件类型、结果
- **NFR10**: 关键安全模式零漏报（可能有误报，但绝不遗漏）

### Integration（集成）

- **NFR11**: 100% 遵守 Claude Code 钩子协议（stdin/stdout JSON 格式）
- **NFR12**: 支持 P0/P1 范围内所有外部工具（shellcheck、shfmt、hadolint、taplo、SQLFluff、stylelint、prettier、check-jsonschema）
- **NFR13**: 配置文件兼容性：现有 `.claude/settings.json` 格式无破坏性变更
- **NFR14**: 日志格式兼容 JSONL schema（timestamp、event、tool、result 字段）

### Reliability（可靠性）

- **NFR15**: 钩子使用 fail-open 策略：外部工具未安装时跳过（不阻塞）
- **NFR16**: 钩子崩溃不阻止开发者工作流（优雅降级）
- **NFR17**: 99.9% 的钩子行为一致性（相同输入 → 相同输出）
- **NFR18**: 所有钩子提供清晰的错误信息和可操作的修复建议

### Tool Strictness（工具严格度）— 已实现

**背景：** 所有校验工具必须启用最严格的检查模式，以确保 AI 生成的代码符合最高质量标准。

**约束条件：**

- **NFR19**: Semgrep 必须启用所有安全和 OWASP 规则包，报告所有严重级别（ERROR、WARNING、INFO）
- **NFR20**: Trivy 必须启用所有扫描器（漏洞、错误配置、密钥、许可证），报告中等级别及以上漏洞
- **NFR21**: ESLint 必须使用 `strict` 预设（非 `strictTypeChecked`，因项目为纯 JS），启用未使用禁用指令报告
- **NFR22**: Ruff 必须启用 preview 模式，启用最新实验性规则
- **NFR23**: ~~TypeScript 必须启用 `strict: true`~~ **不适用** — 项目为纯 JavaScript，无 TypeScript 文件

**实现状态：**

1. **Semgrep 严格模式 ✅**
   - 规则包：`--config p/security-audit --config p/secrets --config p/owasp-top-ten`
   - 报告级别：`--severity ERROR,WARNING,INFO`
   - 影响：增加约 200+ 条安全规则

2. **Trivy 严格模式 ✅**
   - 扫描器：`--scanners vuln,misconfig,secret,license`
   - 严重级别：`--severity CRITICAL,HIGH,MEDIUM`
   - 影响：从仅检测漏洞扩展到检测错误配置、密钥泄露、许可证问题

3. **ESLint 严格模式 ✅**
   - 预设：`strict`（非 `strictTypeChecked`，因项目为纯 JavaScript）
   - 标志：`--report-unused-disable-directives`
   - 影响：启用严格检查，报告未使用的 `// eslint-disable` 注释

4. **Ruff 严格模式 ✅**
   - 标志：`--preview`
   - 影响：启用实验性规则，提前发现潜在问题

5. **TypeScript 严格模式 ❌ 不适用**
   - 原因：项目为纯 JavaScript，无 TypeScript 文件
   - 替代：通过 ESLint 严格模式覆盖代码质量检查

**验证结果：**

- ✅ 所有工具已启用最严格模式
- ✅ 118 个测试全部通过
- ✅ 无回归问题

### Gitignore 兼容性

**背景：** 当前所有钩子都不检查 `.gitignore`，导致：

- post-write-lint 对 git 忽略的生成文件（如 `*.log`、构建产物）做无意义的 lint
- merge-gate 中 Semgrep/Trivy 扫描 git 忽略的目录，浪费时间且产生误报
- protect-secrets 对 git 忽略的敏感文件仍然保护（这是正确的行为，不应受 gitignore 影响）

**约束条件：**

- **NFR24**: post-write-lint 必须跳过 `.gitignore` 中的文件，避免对生成文件/临时文件做无意义校验
- **NFR25**: merge-gate 中 Semgrep 和 Trivy 扫描必须排除 `.gitignore` 中的目录
- **NFR26**: protect-secrets 不应受 `.gitignore` 影响（安全保护优先级高于 gitignore）

**实现方式：**

- 在 `security-orchestrator.js` 中添加 `isGitIgnored()` 工具函数（调用 `git check-ignore -q`）
- post-write-lint 在文件校验前调用 `isGitIgnored()`，git 忽略的文件直接跳过
- merge-gate 中 Semgrep 添加 `--exclude` 标志排除 git 忽略的目录，Trivy 添加 `--skip-dirs` 标志

### Brownfield Compatibility（存量项目兼容性）— P2，本轮不实现

**背景：** 当钩子系统应用到已有项目时，旧代码可能包含大量历史遗留的 lint 警告、安全漏洞或不符合新规范的问题。如果钩子对整文件做全量检查，会导致：

- 每次修改都报出几十个历史问题，用户无法区分新引入 vs 历史遗留
- commit-gate 和 merge-gate 阻断合并，导致旧项目无法使用
- 用户体验极差，可能误以为自己的代码有问题

**推迟原因：**

- P0/P1 阶段优先保障安全覆盖和文件类型扩展，Brownfield 兼容性的实现复杂度高（需解析 git diff、维护 baseline 文件、过滤历史问题）
- 当前 post-write-lint 已是报告模式（不阻断用户），旧项目在 PostToolUse 阶段不会受到严重影响
- commit-gate 和 merge-gate 在旧项目上的问题可通过"仅在 feature 分支启用"的方式暂时规避

**约束条件（P2 实现）：**

- **NFR27**: post-write-lint 必须支持增量校验模式：仅报告 Claude 本次修改引入的新问题，忽略历史遗留问题
- **NFR28**: commit-gate 必须支持 baseline 模式：记录项目启用钩子时的初始问题清单，后续只检查新增问题
- **NFR29**: merge-gate 必须提供宽松模式（relaxed）和严格模式（strict）：宽松模式仅检查新文件和新修改的代码，严格模式进行全量扫描
- **NFR30**: 首次启用钩子时，系统应自动生成 baseline 文件（记录当前所有 lint/security 问题）
- **NFR31**: baseline 文件必须版本控制友好：存储在 `.claude/hooks-baseline/` 目录，格式为 JSON，可按文件/规则类型分类
- **NFR32**: 用户可通过配置切换严格度级别：`strict`（全量检查）、`relaxed`（仅新代码）、`baseline`（对比基线）

**P2 实现策略：**

1. **增量校验：** 解析 `git diff` 获取变更行号，仅报告变更行的问题
2. **自动 baseline 生成：** 首次运行时扫描全项目，生成初始 baseline
3. **增量 baseline 更新：** 每次成功提交后更新 baseline（移除已修复的问题）
4. **配置化严格度级别：** 在项目配置文件中定义每个钩子的严格度
5. **智能分类问题：** 自动区分"新引入"vs"历史遗留"vs"Claude 修复"

**当前影响范围（P0/P1 阶段可接受）：**

| 钩子                     | 影响程度  | 当前行为                                |
| ------------------------ | --------- | --------------------------------------- |
| post-write-lint          | ⚠️ 中等   | 报告模式，不阻断，仅提示历史问题        |
| commit-gate              | ⚠️ 严重   | 全量检查，旧项目可能无法提交（P2 解决） |
| merge-gate               | ⚠️ 严重   | 全量扫描，旧项目可能无法合并（P2 解决） |
| protect-secrets          | ✅ 无影响 | 已按设计工作（仅检查当前内容）          |
| branch-gate              | ✅ 无影响 | 已按设计工作（仅检查分支名）            |
| block-dangerous-commands | ✅ 无影响 | 已按设计工作（仅检查当前命令）          |

### Global Mode Support（全局模式支持）— P1.5，本轮开发中实现

**背景：** 当前钩子系统为项目级（`.claude/hooks/`），配置使用绝对路径。用户需要将钩子系统移动到全局（`~/.claude/hooks/`），使其在所有项目中生效，同时保持项目级钩子的支持。

**实现目标：**

- 同时支持全局钩子（`~/.claude/hooks/`）和项目级钩子（`.claude/hooks/`）
- 全局钩子对所有项目生效，项目级钩子仅对当前项目生效
- 项目级钩子可覆盖全局钩子的配置

**约束条件：**

- **NFR33**: settings.json 必须使用相对路径（`bun .claude/hooks/xxx.js`），而非绝对路径，以支持全局模式
- **NFR34**: merge-gate.js 的测试目录引用必须使用 `import.meta.url` 相对定位，而非硬编码 `.claude/hooks/__tests__/`
- **NFR35**: 所有 git 命令必须显式传入 stdin 中的 `cwd` 字段，而非依赖进程 cwd
- **NFR36**: protect-secrets.js 必须添加 `process.env.HOME || ''` fallback，避免极端环境异常
- **NFR37**: 工具链检测必须基于项目类型（检查 package.json/pyproject.toml），而非硬编码 bun/uv
- **NFR38**: 全局钩子和项目级钩子共存时，项目级配置优先

**实现策略：**

1. **settings.json 路径重写：** 所有 hook command 从绝对路径改为相对路径（`bun .claude/hooks/xxx.js`）
2. **merge-gate.js 测试路径修复：** 使用 `dirname(new URL(import.meta.url).pathname)` 获取脚本自身目录，再定位 `__tests__/`
3. **git 命令 cwd 传递：** 所有调用 `execCommand` 的地方显式传入 `cwd` 参数（从 stdin 获取）
4. **HOME fallback 修复：** protect-secrets.js 第 154 行添加 `|| ''` fallback
5. **工具链检测增强：** 添加项目类型检测函数，根据 `package.json`/`pyproject.toml` 存在性决定使用 bun/uv/npm

**影响范围：**

| 文件                               | 改动                | 优先级     |
| ---------------------------------- | ------------------- | ---------- |
| **settings.json**                  | 绝对路径 → 相对路径 | P0（必须） |
| **merge-gate.js**                  | 测试路径硬编码修复  | P0（必须） |
| **所有使用 git 命令的 hook**       | 显式传入 cwd        | P1（建议） |
| **protect-secrets.js**             | HOME fallback       | P1（建议） |
| **merge-gate.js / commit-gate.js** | 工具链检测增强      | P1（建议） |
| \***\*tests**/\*\*                 | fixtures 目录迁移   | P2（可选） |

**验证标准：**

- ✅ 钩子系统在项目级（`.claude/hooks/`）正常工作
- ✅ 钩子系统迁移到全局（`~/.claude/hooks/`）后正常工作
- ✅ 全局钩子和项目级钩子共存时，项目级配置优先
- ✅ 所有 118 个测试用例通过
