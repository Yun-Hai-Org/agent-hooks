---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
projectName: 20260531-hooks
author: Zhangwm
date: 2026-06-08
---

# UX Design Specification - 20260531-hooks

**Author:** Zhangwm
**Date:** 2026-06-08

---

## Executive Summary

### Project Vision

本项目为 Claude Code CLI 工具构建一套**确定性的 AI 安全护栏体系**，通过钩子（Hooks）机制在 AI 的每次工具调用链路中插入硬性阻断检查。核心理念是"不信任 AI 的推理过程，只信任确定性的、人在回路之外的规则"。当前已实现四门安全架构（写入门、快速门、提交门、合并门），本阶段目标是：**将安全覆盖从"核心流程"扩展到"全文件生态"**，新增 Shell/Dockerfile/TOML/SQL/CSS 等文件类型的自动校验，增强 JSON/YAML 的 Schema 验证能力，并利用 Notification、UserPromptSubmit、SessionStart 等新钩子事件类型构建完整的安全治理闭环。

### Target Users

**核心用户画像：张伟 — 全栈开发者**

- **背景**：32 岁，全栈开发者，SaaS 创业公司，负责后端和基础设施
- **技术能力**：中高级开发者，熟悉 Git、CI/CD、Docker、Shell 脚本
- **使用场景**：日常使用 Claude Code 加速开发（写 API、部署脚本、数据库操作）
- **核心痛点**：Claude 太"能干"，有时会直接修改生产配置文件，差点把 `.env` 文件提交到 GitHub
- **深层需求**：希望全速使用 AI 开发，同时确信安全边界不会被 AI 无意中突破

**次要用户：开发团队**

- 需要共享安全配置和钩子规则
- 需要安全事件的可审计日志
- 需要渐进式信任模型（从报告到阻断，逐级增强）

### Key Design Challenges

1. **安全无感 vs 阻断可见**：安全检查应在背后自动运行，但拦截时必须足够醒目。用户应当感受到"被保护"而非"被限制"
2. **渐进式信任**：PostToolUse（报告）→ commit（阻断）→ merge（全量扫描），三级严重程度和阻断力度需逐级递增，用户需理解每个阶段的含义
3. **fail-open 策略**：工具未安装时不阻塞工作流，但需要给予清晰反馈告知用户"本可提供更高保护"
4. **多文件类型覆盖**：从 .sh/.bash 到 Dockerfile/TOML/SQL/CSS，每种文件类型的校验结果呈现需有一致模式，但又体现各 linter 的独特性
5. **新钩子事件整合**：Notification（飞书通知）、UserPromptSubmit（敏感词过滤）、SessionStart（健康检查）三种新事件需与现有四门架构自然融合

### Design Opportunities

1. **"护栏即品牌"**：拦截消息是用户与安全系统最重要的交互触点。设计一套清晰、一致、可识别的拦截消息格式，让用户从"哎呀被拦了"变成"幸好有护栏"
2. **安全治理仪表盘**：通过 Notification 钩子 + 日志聚合，为团队提供安全事件的统计看板（可选增值功能）
3. **配置即文档**：钩子配置本身就是安全策略的声明式编码。让 `.claude/settings.json` 的配置体验像写安全策略一样直观
4. **版本化的信任演进**：从默认保护到自定义配置的渐进式学习路径，用户可以从"被保护"成长为"主动配置护栏的主人"

## Core User Experience

### Defining Experience

本产品的核心交互发生在**终端/CLI 环境中**，用户通过 Claude Code 自然对话驱动开发，钩子在后台提供确定性安全护栏。用户在四种时刻与安全系统发生交互：

1. **写入门（PreToolUse -> 即时阻断）**：当高危命令、错误分支、敏感文件被访问时，用户看到一个红色阻断消息
2. **快速门（PostToolUse -> 自动报告）**：文件写入后，后台自动运行 lint 检查，输出检查结果摘要
3. **提交门（PreToolUse on git commit -> 预处理扫描）**：用户输入 `git commit` 后，看到扫描进度和结果摘要
4. **合并门（PreToolUse on git merge -> 全量检查）**：合并到 main 时的全量安全扫描

**核心交互模式：用户驱动开发 → 钩子自动拦截/报告 → 用户收到反馈 → 用户决定下一步**

### Platform Strategy

| 维度          | 策略                                     |
| ------------- | ---------------------------------------- |
| **主平台**    | Claude Code CLI（终端环境）              |
| **辅助通知**  | 企业微信/飞书（Notification 钩子）       |
| **交互方式**  | 纯键盘操作，无图形界面                   |
| **日志存储**  | 文件系统（~/.claude/hooks-logs/）        |
| **配置位置**  | `.claude/settings.json`（JSON 配置文件） |
| **离线能力**  | 完全离线运行，不依赖网络服务             |
| **输入/输出** | stdin/stdout JSON 协议                   |
| **跨平台**    | macOS/Linux（Bun 运行时）                |

### Effortless Interactions

1. **透明的拦截**：用户不需要任何操作，安全检查全部自动触发，零配置即可使用
2. **一目了然的反馈**：阻断消息用 `<emoji> [hook-name] 原因 (级别: CRITICAL/HIGH/MEDIUM/LOW)` 格式，用户 1 秒理解"被拦了什么"和"为什么被拦"
3. **自动 lint 修复**：Prettier/Shfmt 等格式化工具自动修复可修复问题，用户无感知
4. **fail-open 保障**：工具未安装时静默跳过，用户工作流永不中断
5. **渐进式信任升级**：同一类问题在不同阶段有不同处理方式（报告→阻断→全量扫描），用户感知到保护力度逐级增强

### Critical Success Moments

| 时刻                      | 成功体验                                                    | 失败后果                                 |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| **第一次被拦截**          | 用户看到清晰拦截消息，感到"被保护"而非"被限制"              | 用户觉得被妨碍，想要禁用钩子             |
| **Shell 脚本被纠正**      | shellcheck 发现 `rm -rf $TEMP_DIR/*` 隐患，用户庆幸有这道门 | 用户没有发现 bug，生产环境执行有漏洞脚本 |
| **提交时拦截**            | 扫描发现密钥或死代码，阻止了一次有问题的提交                | 敏感信息被提交到 Git 历史                |
| **合并时全量扫描**        | 所有安全检查和测试通过，用户确信合并质量                    | 合并后发现回归问题                       |
| **SessionStart 健康检查** | 用户启动时看到所有保护已就绪，获得安全感                    | 保护未生效但用户不知情                   |

### Experience Principles

1. **静默守护，异常报警** — 正常操作无感知，危险操作必有提醒
2. **知其然更知其所以然** — 每次拦截给出具体原因、风险级别、修复建议
3. **渐进阻断，匹配信任** — 报告（PostToolUse）→ 阻断（commit）→ 全量（merge），三级力度逐级递增
4. **默认安全，可选配置** — 开箱即用的保护策略 + 可深度定制的配置入口
5. **先审后决，不误伤人** — fail-open 策略，工具未安装时跳过而非阻塞

## Desired Emotional Response

### Primary Emotional Goals

**核心情感目标：安全感（Sense of Security）**

用户在使用 Claude Code 时应始终感到"被保护"——不是害怕 AI 会做错事，而是知道即使 AI 做错了也会被拦住。这种安全感让用户可以专注于开发效率，放心地让 Claude 处理复杂任务。

**辅助情感目标：**

| 情感       | 触发场景              | 设计策略                   |
| ---------- | --------------------- | -------------------------- |
| **掌控感** | 查看钩子配置和日志    | 配置即文档，一目了然       |
| **信任感** | 多次被"救"之后        | 每次拦截证明系统在保护他   |
| **成就感** | 提交/合并通过所有检查 | 绿色的"全部通过"提示       |
| **安心感** | SessionStart 时       | "所有保护已就绪"的健康报告 |
| **赋能感** | 主动配置安全规则后    | 配置是安全策略的声明式编码 |

### Emotional Journey Mapping

**阶段 1：首次安装（警惕 → 安心）**

- **首次接触**：看到各种拦截消息，可能会觉得"被限制"
- **转折点**：某次拦截真正帮到他（如阻止了危险命令），情绪转变为"幸好有这个"
- **最终状态**：开始信任系统，不再每次盯着 Claude 的操作

**阶段 2：日常使用（无感 → 信赖）**

- **常态**：大部分时间钩子在后台静默运行，用户无感知
- **触发时刻**：PostToolUse 报告 shellcheck 发现隐患，用户意识到钩子正在保护他
- **累积信任**：多次拦截后，用户形成"每次出错都会被拦住"的预期

**阶段 3：主动配置（依赖 → 掌控）**

- **过渡**：了解钩子的工作原理和配置方式
- **主动行为**：添加新的保护规则、启用 Notification 通知
- **掌控状态**：不只是被保护，而是在管理自己的安全策略

**阶段 4：团队推广（内化 → 倡导）**

- **分享**：把配置分享给团队
- **倡导**：成为团队中的 AI 安全治理倡导者
- **最终**：安全护栏成为团队开发文化的一部分

### Micro-Emotions

| 微情感                           | 优先级  | 设计对策                                                 |
| -------------------------------- | ------- | -------------------------------------------------------- |
| **Confidence vs. Confusion**     | 🔴 关键 | 阻断消息必须清晰表明"被拦了什么"和"为什么被拦"，不留疑感 |
| **Trust vs. Skepticism**         | 🔴 关键 | 每次拦截都需证明其必要性，错误的误报会破坏信任           |
| **Calm vs. Panic**               | 🟡 重要 | 红色阻断消息应附带清晰的修复建议，引导用户而非吓唬用户   |
| **Satisfaction vs. Frustration** | 🟡 重要 | 校验通过时给予"绿色通过"的正反馈，而非只报告错误         |
| **Empowerment vs. Helplessness** | 🟢 次要 | 提供配置入口，用户可关闭/调整规则——但默认安全            |

### Design Implications

1. **安全感 → 拦截消息格式标准化**
   - 格式：`🚫 [hook-name] 拦截原因 (级别: CRITICAL)`
   - 颜色：红色(HIGH+)、黄色(MEDIUM)、白色(LOW)三级
   - 始终附带修复建议短语

2. **掌控感 → 配置即文档**
   - `.claude/settings.json` 的配置项要直观到无需查文档
   - 每个钩子在 `settings.json` 中有明确的启用/禁用开关

3. **信任感 → 日志可审计**
   - 所有拦截记录到 `~/.claude/hooks-logs/`
   - JSONL 格式，每条记录包含：时间戳、事件类型、工具名、结果、原因

4. **成就感 → 正面反馈**
   - 通过检查时输出 `✅ [post-write-lint] Shell 校验通过 (shfmt+shellcheck)`
   - 合并门全量通过时输出 `✅ [merge-gate] 全部 42 项检查通过，可以安全合并`

5. **安心感 → SessionStart 健康检查**
   - 启动时输出可用工具列表和状态：`🟢 shellcheck ✔ hadolint ✔ SQLFluff ❌（未安装）`
   - 未安装的工具明确标注"未安装"，而非"不可用"

### Emotional Design Principles

1. **不惊吓，不困惑** — 安全消息不应让用户恐慌，而应让用户感到"被守护"
2. **正面比负面多** — 通过检查的反馈频率应 ≥ 拦截消息的频率
3. **每次拦截都是一次信任建设** — 每次拦截都要让用户说"幸好有它"，而不是"真烦人"
4. **渐进式安全成熟度** — 用户的情绪状态应随使用时间从警惕→信赖→掌控逐步演进

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

**1. Clippy（类比：框架自带的 lint 工具）**

- 用户体验类似 Rust 的 `cargo clippy` 或 ESLint 的 `--fix` 模式
- 核心模式：发现问题 → 给出修复建议 → 可自动修复 → 用户决定是否采纳
- 关键差异：本产品是在 AI 的调用链路中自动触发，而非开发者手动运行

**2. macOS 安全锁（类比：系统级安全提示）**

- 当 App 第一次访问麦克风/摄像头/文件时弹出授权对话框
- 核心模式：默认授权 → 敏感操作时弹窗 → 用户可选择"始终允许"
- 借鉴：第一次被阻拦时给予清晰解释，之后同类操作自动拦截，不再重复询问

**3. GitHub Dependabot（类比：自动安全扫描 + PR）**

- 自动发现依赖漏洞 → 自动创建修复 PR → 用户 review 后合并
- 核心模式：自动扫描 → 报告 → 提供修复方案 → 用户决策
- 借鉴：commit-gate 和 merge-gate 的扫描报告应采用类似的"问题 + 修复建议"格式

**4. VSCode 错误诊断（类比：内联 lint 反馈）**

- 在编辑器中实时显示 lint 错误、警告、提示（红/黄/蓝波浪线）
- 核心模式：实时反馈 → 分级严重度 → 可操作的修复建议
- 借鉴：PostToolUse lint 输出的分级颜色和严重度标记

**5. UFW（Uncomplicated Firewall，类比：简单的安全配置）**

- 简洁的语法：`ufw allow 22/tcp` 比 `iptables -A INPUT -p tcp --dport 22 -j ACCEPT` 直观得多
- 核心模式：复杂底层规则的简化 DSL + 默认安全策略
- 借鉴：配置文件要像 UFW 一样直观——配置行本身就是可读的安全策略声明

### Transferable UX Patterns

| 来源              | 模式                                | 本产品适配                                                      |
| ----------------- | ----------------------------------- | --------------------------------------------------------------- |
| **ESLint/Clippy** | 问题代码 + 行号 + 规则号 + 修复建议 | PostToolUse lint 输出：`file:line:col — rule_id: 描述 (严重度)` |
| **macOS 安全锁**  | 首次询问 → 记住决策 → 后续自动处理  | protect-secrets 首次拦截时详细解释，后续同类文件自动处理        |
| **Dependabot**    | 自动扫描 → 生成报告 → 提供修复 PR   | commit-gate/merge-gate 的扫描摘要格式                           |
| **VSCode 诊断**   | 红/黄/蓝三级严重度                  | ERROR/CRITICAL=红色, WARNING/HIGH=黄色, INFO/MEDIUM=蓝色        |
| **UFW**           | 简单的声明式语法                    | settings.json 的配置项命名要像自然语言策略                      |

### Anti-Patterns to Avoid

1. **❌ 过度告警（Alert Fatigue）** — 如果每个 lint 发现都弹红色阻断消息，用户很快就会无视所有告警
   - 对策：PostToolUse 只能是报告模式（黄色），只有 commit/merge 才能升级为阻断（红色）

2. **❌ 技术噪音（Technical Noise）** — 直接输出 linter 的原始报错（如 `SC2115: Use "${var:?}" to prevent globbing`）
   - 对策：输出格式化 + 中文/简单英文说明，确保消息可操作

3. **❌ 假阳性破坏信任** — 不必要的拦截会让用户关闭安全功能
   - 对策：protect-secrets 使用精确匹配，宁可漏报不可误报

4. **❌ 信息过载** — 一次提交扫描列出 50 个问题，用户直接放弃
   - 对策：commit-gate 按严重度排序，只阻断 CRITICAL/HIGH 级别，MEDIUM/LOW 仅报告

5. **❌ 隐藏状态** — 用户不知道钩子是否在工作
   - 对策：SessionStart 时主动报告健康状态，明确告知哪些保护已就绪

### Design Inspiration Strategy

**直接采用：**

- 拦截消息格式 `<emoji> [hook-name] 原因 (级别: 严重度)` — 借鉴 ESLint + macOS 安全锁的模式
- 三级颜色 (红/黄/蓝) — 来自 VSCode 诊断系统
- fail-open + 首次询问机制 — 来自 macOS 安全锁

**改造适配：**

- Commit-gate 扫描摘要 = Dependabot 报告格式 + CLI 终端友好输出
- Configuration 命名 = UFW 风格（声明式可读）+ JSON Schema 自动补全

**明确避免：**

- 不输出原始 linter 错误消息（必须格式化）
- 不重复报告相同问题（同类型拦截自动聚合）
- 不在 PostToolUse 阶段使用红色阻断（仅报告模式）

## Design System Foundation

### 1.1 Design System Choice

**选择：自定义 CLI 输出规范（Custom Terminal Output Design System）**

本产品是纯 CLI 工具，无图形界面。设计系统表现的载体是终端文本输出——包括拦截消息、lint 报告、扫描摘要、健康检查状态。因此"设计系统"在本项目中 = 一套标准化的终端消息格式规范。

### Rationale for Selection

1. **平台决定** — Claude Code 在终端中运行，所有交互通过 stdout 文本完成，无 UI 组件库需求
2. **阅读体验** — 终端输出有限（80 列宽、纯文本/ANSI 颜色），需要有极其精简的格式
3. **一致性** — 所有钩子使用相同的消息格式，用户在任何拦截场景下都能立即理解
4. **可搜索性** — 标准化的消息格式便于在日志中 grep/搜索
5. **国际化** — 纯文本格式便于后续翻译（表情符号 + 英文关键词）

### Implementation Approach

**终端消息规范（4 层结构）：**

```
[严重度标记] [钩子名] 消息内容 (上下文)
```

**严重度标记（ANSI 颜色 + 表情符号）：**

| 类型     | 表情 | 颜色 | 适用场景                     |
| -------- | ---- | ---- | ---------------------------- |
| **阻断** | 🚫   | 红色 | PreToolUse 拦截（写入门）    |
| **拒绝** | 🛡️   | 黄色 | commit-gate/merge-gate 拒绝  |
| **警告** | ⚠️   | 黄色 | PostToolUse lint 发现        |
| **通过** | ✅   | 绿色 | 校验通过、扫描通过           |
| **信息** | ℹ️   | 蓝色 | SessionStart 健康检查        |
| **跳过** | ⏭️   | 灰色 | fail-open 跳过（工具未安装） |

**消息格式示例：**

```
🚫 [block-dangerous-commands] 禁止直接推送 main 分支 (级别: CRITICAL)
🛡️ [commit-gate] 发现 2 个安全漏洞、3 个死代码问题，提交已阻止
⚠️ [post-write-lint] shellcheck: backup.sh:12 — SC2115: 变量未引号包裹 (级别: MEDIUM)
✅ [merge-gate] 全部 42 项检查通过，可以安全合并
ℹ️ [session-start] 🟢 shellcheck ✔ hadolint ✔ SQLFluff ❌（未安装）
⏭️ [post-write-lint] hadolint 未安装，跳过 Dockerfile 校验
```

**具体实现约束：**

1. 所有消息不超过终端 80 列宽
2. 中文和英文混合时使用空格分隔
3. 表情符号作为严重度视觉标记（终端兼容 Unicode 12+）
4. 消息输出到 stdout（不干扰 Claude Code 的正常输出流）
5. 日志文件使用 JSONL 格式（结构化为 JSON 而非文本）

### Customization Strategy

1. **钩子级别配置** — 用户可在 settings.json 中配置每个钩子的消息详细程度（brief/normal/verbose）
2. **通知渠道配置** — Notification 钩子可配置发送到企业微信/飞书/Slack，消息格式适配各平台
3. **语言偏好** — 可通过环境变量 `HOOK_LANG=zh/en` 切换输出语言（当前为中文，英文为 future）
4. **颜色开关** — 可通过环境变量 `NO_COLOR=1` 禁用 ANSI 颜色（兼容不支持彩色的终端）

## Core User Experience

### Defining Experience

**本产品定义的体验（The Defining Experience）："在 Claude Code 中自由开发，钩子在背后自动守住安全底线"**

核心交互模式可以浓缩为一个循环：

```
用户用自然语言描述任务 → Claude 执行 → 钩子自动拦截/校验 → 用户看到反馈 → 继续/修正
```

这个循环中，钩子扮演"静默守卫"的角色——正常时不可见，异常时才出现。用户的核心体验是**自由感 + 安全感并存**：Claude 可以做任何事，但危险的事会被拦住。

面向朋友描述为："我让 AI 写代码，当我担心它可能搞砸时，一个自动化的安全系统在后面兜底。"

### User Mental Model

用户带入的思维模型：**"自动安全检测"**

- 用户在 Claude Code 上写代码，类似于在 VSCode 中写代码——期望有"编译时"检查和"运行时"保护
- 用户对安全系统的心理模型是"交通信号灯"：绿灯通行（通过）、黄灯注意（警告）、红灯停下（阻断）
- 用户预期所有检查是自动触发的，不需要手动命令

**容易困惑的点：**

- 为什么同一文件在 PostToolUse 是警告，在 commit 就是阻断？（需理解渐进式信任）
- 为什么有些校验跳过？（fail-open 策略，需明确告知"工具未安装"而非"检查失败"）
- 为什么不同钩子的消息格式略有不同？（需标准化）

### Success Criteria

| 标准       | 定义                                             | 验证方式                     |
| ---------- | ------------------------------------------------ | ---------------------------- |
| **自由**   | 用户可正常使用 Claude Code，钩子不干扰非危险操作 | 95% 的正常操作不触发任何阻断 |
| **安心**   | 用户知道钩子在保护他，即使没看到拦截消息         | 用户主动说"我知道钩子在工作" |
| **清晰**   | 遇到拦截时，用户在 3 秒内理解"为什么被拦"        | 用户能复述拦截原因           |
| **可操作** | 遇到拦截时，用户知道下一步怎么做                 | 用户能立即修正问题           |
| **透明**   | 用户知道哪些保护已就绪、哪些未就绪               | SessionStart 报告清晰可见    |

### Novel UX Patterns

**本产品不创造全新的交互模式，而是将现有安全/开发工具的模式组合并适配到 AI 调用链路中：**

| 模式                  | 来源                                 | 本组合的新意                   |
| --------------------- | ------------------------------------ | ------------------------------ |
| PreToolUse 阻断       | Git hooks（pre-commit, pre-push）    | 首次应用于 AI 的 Bash 工具调用 |
| PostToolUse 自动 lint | VSCode 保存后自动格式化              | 在 AI 写入后而非人类写入后触发 |
| 渐进式阻断            | 安全领域深度防御（Defense in Depth） | 应用到 AI Agent 的行为控制     |
| SessionStart 健康检查 | 监控系统的启动自检                   | 首次在 AI 工具上下文中实现     |

**简洁性创新：** 传统上，开发者需要配置 Git hooks + CI 管道 + IDE 插件 + 独立安全扫描工具——共 4-5 个独立系统。本产品通过
Claude Code 钩子机制将这一切整合为**一个配置入口、一套消息格式、一个运行环境**。

### Experience Mechanics

**1. 写入门（PreToolUse——阻断）**

- **触发条件**：Claude 调用 Bash/Edit/Write 工具，且操作匹配阻断规则
- **用户行为**：无（完全自动）
- **系统响应**：立即输出红色阻断消息 + 原因 + 级别
- **用户反馈**：看到 `🚫 [hook-name] 原因 (级别: CRITICAL)`
- **后续**：Claude 被阻止，用户可要求 Claude 换一种方式

**2. 快速门（PostToolUse——报告）**

- **触发条件**：Edit/Write 工具写入文件后
- **用户行为**：无（完全自动，后台运行）
- **系统响应**：运行 lint/format，输出检查摘要
- **用户反馈**：看到 `⚠️ [post-write-lint] shellcheck: file.sh:行号 — 问题描述 (级别: MEDIUM)`
- **后续**：可修复的问题自动修复，不可修复的问题用户可手动修正

**3. 提交门（PreToolUse on git commit——扫描）**

- **触发条件**：Claude 执行 `git commit -m "feat: 描述"`
- **用户行为**：输入 commit 命令
- **系统响应**：运行 Semgrep + Knip + 依赖审计 + 关联测试，输出扫描摘要
- **用户反馈**：看到 `🛡️ [commit-gate] 发现 2 个安全漏洞、3 个死代码问题，提交已阻止`
- **后续**：用户需修正问题后重新提交，或手动确认豁免

**4. 合并门（PreToolUse on git merge——全量扫描）**

- **触发条件**：Claude 执行 `git merge feature-branch` 到 main
- **用户行为**：输入 merge 命令
- **系统响应**：运行 Semgrep + Knip + Trivy 全量扫描 + 全量测试
- **用户反馈**：看到 `✅ [merge-gate] 全部 42 项检查通过，可以安全合并` 或 `🛡️ [merge-gate] 安全检查未通过，阻止合并`
- **后续**：通过则合并，不通过需修复

**5. 新钩子事件**

| 事件                 | 触发               | 输出                                 |
| -------------------- | ------------------ | ------------------------------------ |
| **Notification**     | 安全事件发生时     | 通过 Webhook 发送通知到企业微信/飞书 |
| **UserPromptSubmit** | 用户输入提示词时   | 扫描敏感词，匹配时拒绝或警告         |
| **SessionStart**     | Claude Code 启动时 | 输出可用工具的健康检查报告           |

## Visual Design Foundation

### Color System

**本产品为 CLI 终端输出，视觉设计 = ANSI 终端颜色规范**

| 语义          | ANSI 颜色码               | 颜色 | 用途                                   |
| ------------- | ------------------------- | ---- | -------------------------------------- |
| **阻断/错误** | `\x1b[31m` (Red)          | 红色 | 🚫 PreToolUse 拦截、CRITICAL/HIGH 级别 |
| **警告**      | `\x1b[33m` (Yellow)       | 黄色 | ⚠️ PostToolUse lint 发现、MEDIUM 级别  |
| **通过**      | `\x1b[32m` (Green)        | 绿色 | ✅ 校验通过、扫描通过                  |
| **信息**      | `\x1b[34m` (Blue)         | 蓝色 | ℹ️ SessionStart 健康检查、LOW 级别     |
| **跳过**      | `\x1b[90m` (Bright Black) | 灰色 | ⏭️ fail-open 跳过通知                  |
| **强调**      | `\x1b[1m` (Bold)          | 粗体 | 钩子名称、文件路径、行号               |
| **重置**      | `\x1b[0m`                 | 默认 | 常规文本                               |

**逐级严重度颜色映射：**

- CRITICAL: 红色 + 粗体 — 立即执行危险操作
- HIGH: 红色 — 敏感文件访问、高危命令
- MEDIUM: 黄色 — lint 发现的问题、安全警告
- LOW: 蓝色 — 信息提示、可选修复
- PASS: 绿色 — 所有检查通过

**无障碍（NO_COLOR 支持）：**

- 当 `NO_COLOR=1` 时，所有 ANSI 颜色码关闭
- 严重度通过表情符号（🚫🛡️⚠️✅）区分，不依赖颜色

### Typography System

**CLI 终端的"排版" = 输出的格式结构：**

| 元素          | 格式规范                                       | 示例                         |
| ------------- | ---------------------------------------------- | ---------------------------- |
| **钩子名称**  | `[bold][hook-name][reset]`                     | `[block-dangerous-commands]` |
| **严重度**    | `[emoji] (级别: [ansi-color]CRITICAL[reset])`  | `(级别: CRITICAL)`           |
| **文件路径**  | `[bold]path/file[reset]:[yellow]line[reset]`   | `backup.sh:12`               |
| **规则 ID**   | `[cyan]rule_id[reset]`                         | `SC2115`                     |
| **消息主体**  | `[default]消息内容[reset]`                     | 正常文本                     |
| **摘要/统计** | `[green]N 项通过[reset], [red]M 项失败[reset]` | `40 项通过, 2 项失败`        |

**布局约束：**

- 最大行宽：80 字符（标准终端宽度）
- 消息结构：`[emoji] [位置] 描述 (上下文)`
- 多行 lint 结果：每行一个发现，行号对齐
- 扫描摘要：分节显示（安全/死代码/依赖/测试）

### Spacing & Layout Foundation

**CLI 文本布局规则：**

1. **单行消息**（写入门/快速门）：一行完成，80 字符内

   ```
   🚫 [block-dangerous-commands] 禁止直接推送 main 分支 (级别: CRITICAL)
   ```

2. **多行报告**（提交门/合并门）：首行摘要 + 逐项列出

   ```
   🛡️ [commit-gate] 安全检查未通过 (2 项失败 / 40 项总)
   安全扫描:
     ❌ Semgrep: 发现 1 个高危漏洞
     ❌ Trivy: 发现 1 个密钥泄露
   死代码检测:
     ✅ Knip: 0 个未使用（通过）
   依赖审计:
     ✅ 0 个已知漏洞（通过）
   ```

3. **健康检查报告**（SessionStart）：两列对齐
   ```
   ℹ️ [session-start] 钩子健康检查报告
     shellcheck  →  🟢 已安装 (v0.10.0)
     hadolint   →  🟢 已安装 (v2.12.0)
     SQLFluff   →  🔴 未安装
     taplo      →  🟢 已安装 (v0.9.0)
   ```

### Accessibility Considerations

1. **NO_COLOR 环境变量** — 完全关闭颜色时，通过表情符号和文本标记区分严重度
2. **终端兼容性** — 使用标准 ANSI 转义码（所有现代终端支持），不使用 24-bit 真彩色
3. **文本回退** — 万一表情符号不显示，使用 ASCII 替代：`[!]` 代替 🚫，`[*]` 代替 ✅
4. **可读性** — 英文关键词使用 CamelCase 或连字符分隔，中文使用空格分隔

## Design Direction Decision

### Design Directions Explored

生成了 4 种 CLI 终端输出风格方向，详见 `_bmad-output/planning-artifacts/ux-design-directions.html`：

| 方向                      | 风格                                  | 特点                                                   |
| ------------------------- | ------------------------------------- | ------------------------------------------------------ |
| **🌙 暗色主题 (Dark)**    | `🚫 [hook-name] 消息 (级别)` — 一行式 | 默认风格，ANSI 颜色 + Emoji + 紧凑格式，适合夜间开发者 |
| **☀️ 亮色主题 (Light)**   | 同上结构，浅色背景配色                | 高对比度适配，适合亮色终端                             |
| **📄 极简风格 (Minimal)** | 省略钩子名，仅保留核心                | 追求最快的消息读取速度，适合经验丰富的用户             |
| **📋 详细风格 (Verbose)** | ASCII 边框面板 + 完整上下文           | 结构化面板展示，适合审计和培训场景                     |

### Chosen Direction

**推荐：暗色主题（Dark Theme）— 作为默认风格**

选择理由：

1. **一致性** — `🚫 [hook-name] 原因 (级别)` 格式在所有钩子间一致，用户可在任何拦截场景下立即理解
2. **双重编码** — 颜色（ANSI red/yellow/green/blue）+ 表情符号（🚫🛡️⚠️✅ℹ️）双重标记严重度，终端颜色关闭或表情符号不支持时仍有回退
3. **紧凑高效** — 80 列宽限制下，一行消息能完整表达"谁 + 什么 + 为什么 + 多严重"
4. **可扩展性** — 多行报告（commit/merge）在此基础上通过缩进和分节扩展

**可选切换机制：** 用户可通过 settings.json 配置 `output_style` 字段在 dark/light/minimal/verbose 之间切换。

### Design Rationale

| 决策                     | 依据                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| 采用一行式而非面板式     | 面板式（verbose）在终端中占用 7+ 行，不适用于高频拦截场景                                    |
| 钩子名称用方括号包裹     | 一眼识别是哪个钩子在工作，与传统工具（ESLint、shellcheck）的 `<file>:<line> <rule>` 格式一致 |
| 严重度放在消息末尾括号内 | 首先告诉用户"什么事"，再告诉"多严重"——符合阅读认知流                                         |
| 表情符号 + 颜色双重编码  | 终端环境不可控（颜色可能被禁用、emoji 可能不支持），双重编码确保至少一种有效                 |
| 通过消息统一用绿色 ✅    | 正面反馈的频率 > 负面反馈，绿色通过消息鼓舞用户信心                                          |

### Implementation Approach

1. **第一阶段（P0）** — 实现暗色主题的 Core 格式规范（🚫🛡️⚠️✅ℹ️⏭️），所有现有钩子统一输出格式
2. **第二阶段（P1）** — 添加 output_style 配置支持（dark/light/minimal/verbose）
3. **NO_COLOR 支持** — 所有钩子检测 `process.env.NO_COLOR`，关闭 ANSI 颜色码
4. **表情符号回退** — 检测终端表情符号支持，不支持的终端自动使用 ASCII 替代
5. **HTML 可视化器** — 生成的 `ux-design-directions.html` 可作为设计参考和团队文档

## User Journey Flows

### 旅程 1：从"信任 AI"到"信任护栏"（觉醒之旅）

**触发条件：** 用户在 Claude Code 中请求"帮我写一个部署脚本"

```
flowchart TD
    A[用户请求: "帮我写部署脚本"] --> B[Claude 编写并尝试 git push main]
    B --> C{PreToolUse 拦截}
    C -->|匹配规则: 禁止 push main| D[🚫 block-dangerous-commands]
    D --> E[用户看到红色拦截消息]
    E --> F{用户反应}
    F -->|"幸好被拦了"| G[理解保护价值]
    F -->|"为什么不能 push?"| H[查看拦截原因]
    H --> G
    G --> I[改变工作方式: 使用 feature 分支]

    style C fill:#ff4444,color:#fff
    style D fill:#ff4444,color:#fff
    style G fill:#4caf50,color:#fff
```

**关键交互点：**

- 拦截消息必须出现在 Claude 的响应中（不是隐藏的 stderr）
- 拦截原因必须让用户 1 秒内理解"为什么这个操作被禁止"
- 后续引导：用户应自然学会使用 feature 分支（而非感到被限制）

### 旅程 2：写 Shell 脚本被"救"回来（错误预防之旅）

**触发条件：** Claude 写入 `backup.sh` 文件

```
flowchart TD
    A[Claude 写入 backup.sh] --> B[PostToolUse 钩子触发]
    B --> C[运行 shellcheck + shfmt]
    C --> D{发现 lint 问题?}
    D -->|是| E[⚠️ post-write-lint 报告问题]
    D -->|否| F[✅ 校验通过]
    E --> G[用户看到 lint 警告]
    G --> H{用户行动}
    H -->|"修复它"| I[要求 Claude 修复]
    H -->|"问题不大"| J[继续使用]
    I --> K[Claude 重写 + 再次校验]
    K --> D

    style B fill:#2196f3,color:#fff
    style D fill:#ff9800,color:#fff
    style F fill:#4caf50,color:#fff
```

**关键交互点：**

- lint 消息在文件写入后立即显示
- 消息包含文件路径、行号、规则 ID、描述，可直接复制给 Claude 修复
- 自动格式化（shfmt）用户无感知

### 旅程 3：Dockerfile 的安全隐患（最佳实践之旅）

**触发条件：** Claude 写入 `Dockerfile`

```
flowchart TD
    A[Claude 写入 Dockerfile] --> B[PostToolUse 触发]
    B --> C[运行 hadolint]
    C --> D{发现安全问题?}
    D -->|是| E[⚠️ post-write-lint 报告 hadolint 发现]
    D -->|否| F[✅ 校验通过]
    E --> G[用户看到 3 个安全问题]
    G --> H[用户要求 Claude: 按 hadolint 建议修复]
    H --> I[Claude 重写 Dockerfile]
    I --> J[再次校验]
    J --> K{全部通过?}
    K -->|是| F
    K -->|否| E

    style B fill:#2196f3,color:#fff
    style D fill:#ff9800,color:#fff
    style F fill:#4caf50,color:#fff
```

**关键交互点：**

- 文件名匹配（Dockerfile 无扩展名）
- 安全相关规则（root 用户、镜像 tag）标记为更高优先级
- hadolint 输出区分"安全规则"和"风格规则"

### 旅程 4：从"被保护"到"主动配置"（掌控之旅）

**触发条件：** 用户希望启用 Notification 钩子

```
flowchart TD
    A[用户想要安全通知] --> B[查看文档/CLAUDE.md]
    B --> C[在 settings.json 配置 Notification]
    C --> D[Claude Code 启动时触发 SessionStart]
    D --> E[ℹ️ 健康检查报告: 所有工具状态]
    E --> F[用户开始开发]
    F --> G[PreToolUse 拦截安全事件]
    G --> H[Notification 钩子触发]
    H --> I[飞书/企业微信收到通知]
    I --> J[用户可在手机端查看拦截事件]

    subgraph 配置阶段
    B --> C
    end

    subgraph 运行阶段
    D --> E --> F --> G --> H --> I --> J
    end

    style C fill:#ff9800,color:#fff
    style E fill:#2196f3,color:#fff
    style I fill:#4caf50,color:#fff
```

**关键交互点：**

- `settings.json` 的配置项应直观到无需查文档
- SessionStart 在 Claude Code 每次启动时自动运行
- 通知消息格式适配企业微信/飞书的消息卡片

### Journey Patterns

| 模式                    | 描述                                           | 应用场景                   |
| ----------------------- | ---------------------------------------------- | -------------------------- |
| **自动触发 → 即时反馈** | 用户无操作，钩子自动触发并输出反馈             | 所有旅程的基础模式         |
| **发现 → 理解 → 行动**  | 用户看到消息 → 理解含义 → 决定下一步           | 旅程 1/2/3 的认知循环      |
| **渐进式防护升级**      | PostToolUse(报告) → commit(阻断) → merge(全量) | 同类型问题的三级处理       |
| **配置即安全策略**      | settings.json 中的配置行 = 可读的安全规则      | 用户从"被保护"到"主动配置" |

### Flow Optimization Principles

1. **最小干预原则** — 钩子只在必要时出现，95% 的正常操作不产生任何阻断消息
2. **即时反馈原则** — 所有反馈在操作完成后 500ms 内输出，不给用户等待感
3. **可操作原则** — 每个拦截/警告消息都附带修复建议（"用什么工具修复"或"如何避免"）
4. **渐进式学习** — 新用户从"看到拦截消息→理解原因→知道如何避免"的自然学习路径
5. **错误恢复优先** — 失败路径比成功路径更需要精心设计，确保用户在出错时知道怎么做

## Component Strategy

### Message Type Components

本产品作为 CLI 工具，UI "组件" = 终端消息的类型定义。以下为所有钩子输出的消息类型规范：

| 消息类型               | 表情 | 颜色 | 场景              | 结构                                      |
| ---------------------- | ---- | ---- | ----------------- | ----------------------------------------- |
| **阻断消息 (Block)**   | 🚫   | 红色 | PreToolUse 拦截   | `🚫 [hook] 原因 (级别: CRITICAL)`         |
| **拒绝消息 (Reject)**  | 🛡️   | 黄色 | commit/merge 拒绝 | `🛡️ [hook] 摘要 (N项失败/M项总)`          |
| **警告消息 (Warning)** | ⚠️   | 黄色 | lint 发现         | `⚠️ [hook] file:line — rule: 描述 (级别)` |
| **通过消息 (Pass)**    | ✅   | 绿色 | 校验通过          | `✅ [hook] 全部N项检查通过`               |
| **信息消息 (Info)**    | ℹ️   | 蓝色 | 健康检查/状态     | `ℹ️ [hook] 内容`                          |
| **跳过消息 (Skip)**    | ⏭️   | 灰色 | fail-open 跳过    | `⏭️ [hook] 工具未安装，跳过`              |

### Custom Component Specifications

**1. 阻断消息 (BlockMessage)**

- **目的**：阻止 AI 执行危险操作，让用户立即理解拦截原因
- **使用场景**：写入门（PreToolUse）的所有拦截
- **组成**：表情符号 + 钩子名称 + 原因描述 + 严重度
- **状态**：CRITICAL(红色), HIGH(红色), MEDIUM(黄色), LOW(蓝色)
- **交互行为**：阻断 AI 的工具调用，用户在 Claude Code 界面看到消息

**2. 扫描报告 (ScanReport)**

- **目的**：聚合显示 commit/merge 阶段多个扫描工具的结果
- **使用场景**：commit-gate, merge-gate
- **组成**：首行摘要 → 分节列表（安全/死代码/依赖/测试）
- **状态**：通过(绿色全部), 部分失败(黄色), 阻断(红色)
- **布局**：首行 `🛡️ [hook] 状态 (N项失败/M项总)` → 缩进的逐项列表

**3. 健康检查报告 (HealthReport)**

- **目的**：在 SessionStart 时报告各工具的可用状态
- **使用场景**：SessionStart 钩子
- **组成**：标题 → 工具名 + 状态 + 版本号
- **状态**：已安装(绿色), 未安装(红色)
- **布局**：两列对齐格式

**4. 多行 lint 报告 (LintReport)**

- **目的**：显示一个或多个 lint 发现的问题
- **使用场景**：post-write-lint
- **组成**：每行一个发现：文件路径:行号 → 规则ID: 描述
- **状态**：单个发现/多个发现/无发现
- **布局**：单文件单行，多文件多行

**5. 通知消息 (NotificationMessage)**

- **目的**：通过外部渠道发送安全事件通知
- **使用场景**：Notification 钩子 → 飞书/企业微信
- **组成**：事件类型 + 时间 + 描述 + 严重度
- **适配**：企业微信 Markdown 卡片 / 飞书消息卡片

### Component Implementation Strategy

1. **消息格式化函数** — 在 `security-orchestrator.js` 中添加 `formatBlock()`, `formatReport()`, `formatHealth()`, `formatLint()`, `formatInfo()`, `formatSkip()` 等工具函数
2. **ANSI 颜色封装** — `colorize(text, color)` 函数处理终端颜色输出，`NO_COLOR` 环境变量检测
3. **消息长度约束** — `truncate(text, maxWidth=80)` 确保所有消息不超过终端宽度
4. **JSONL 日志格式化** — 所有消息同时输出结构化 JSON 到日志文件

### Implementation Roadmap

**Phase 1 — Core (P0):**

- BlockMessage: 所有写入门钩子统一格式 ✅
- LintReport: post-write-lint 统一格式
- ScanReport: commit-gate/merge-gate 统一格式

**Phase 2 — Enhancement (P1):**

- HealthReport: SessionStart 钩子
- NotificationMessage: Notification 钩子
- output_style 配置支持 (dark/light/minimal/verbose)
- Message formatting 工具函数抽取

**Phase 3 — Polish (P2):**

- 集中化消息模板引擎
- 国际化消息支持 (英文版)
- 可配置的消息详细程度级别

## UX Consistency Patterns

### Feedback Patterns

本产品的"反馈模式"= 终端消息的输出规则，所有钩子必须遵循:

**1. 即时反馈（写入门）**

- 触发后立即输出，不缓存、不延迟
- 格式：`[emoji] [hook-name] 消息 (级别: SEVERITY)`
- 规则：一行内完成，80 字符以内
- 严重度：CRITICAL=红色, HIGH=红色, MEDIUM=黄色, LOW=蓝色

**2. 批量报告（快速门/提交门/合并门）**

- 首行摘要（通过/失败总数）→ 每行一个结果
- 格式：`[emoji] [hook] 摘要 (X 项失败 / Y 项总)`
- 子项格式：`  [emoji] ToolName: 描述`
- 结果顺序：失败项在前（红色），通过项在后（绿色）

**3. 健康检查报告**

- 仅在 SessionStart 时输出
- 格式：两列对齐
- 状态：绿色=已安装, 红色=未安装, 黄色=版本过旧

**4. 跳过通知**

- 当工具未安装时输出
- 格式：`⏭️ [hook] tool-name 未安装，跳过检查`
- 颜色：灰色
- 级别：LOW（仅报告，不关注）

### Error Handling Patterns

| 错误类型         | 表现                                         | 用户看到     | 恢复方式           |
| ---------------- | -------------------------------------------- | ------------ | ------------------ |
| **工具未安装**   | `⏭️ 工具未安装，跳过`                        | 灰色跳过消息 | 安装工具后重新启动 |
| **钩子脚本崩溃** | `⚠️ [hook] 执行异常，已跳过（不影响工作流）` | 黄色警告     | 报告给开发者修复   |
| **配置错误**     | `⚠️ [hook] 配置解析失败，使用默认配置`       | 黄色警告     | 检查 settings.json |
| **未知文件类型** | `⏭️ 无对应校验器，跳过`                      | 灰色跳过消息 | 无操作             |

### Consistency Rules

1. **消息格式统一** — 所有钩子使用相同的 `[emoji] [hook-name] 描述 (上下文)` 格式
2. **严重度分级** — CRITICAL > HIGH > MEDIUM > LOW > PASS，颜色/表情对应
3. **通过消息必须出现** — 即使全部通过也要输出绿色确认消息（提供正反馈）
4. **同类型消息聚合** — 同一次操作触发多个 lint 检查时，合并为一个报告输出
5. **跳过消息不重复** — 同一个工具在一次会话中未安装，只报告一次
6. **日志结构化** — 所有输出同时以 JSONL 格式写入日志文件，包含时间戳和会话 ID

## Responsive Design & Accessibility

### Responsive Strategy

本产品为 CLI 终端工具，**无图形界面**，因此"响应式设计"不涉及屏幕尺寸适配。但需要考虑以下终端环境的响应式因素：

| 环境 | 考量 | 适配策略 |
|------|------|---------|
| **终端宽度（80列标准）** | 默认 80 列，用户可调整 | 消息保持在 80 字符内，超长路径自动截断 |
| **终端颜色支持** | 标准 ANSI 16色 / 256色 / true color | 使用标准 ANSI 16 色，不依赖 true color |
| **Emoji 支持** | 现代终端支持 unicode emoji | 提供 ASCII 回退（🚫→[!], ✅→[*], ⚠️→[!]） |
| **字体/字号** | 由用户终端决定 | 不依赖特定字体，使用朴素 ASCII 布局 |
| **暗色/亮色模式** | 由用户终端主题决定 | 使用 ANSI 标准颜色，自动适配终端背景 |
| **跨平台** | macOS Terminal / iTerm2 / Windows Terminal / Linux | 使用 ANSI 转义码标准，确保跨终端兼容 |

### Breakpoint Strategy

**不适用。** CLI 终端没有"断点"概念。统一按 80 列宽标准格式化输出。

### Accessibility Strategy

**WCAG 目标：Level A（基本可达性）+ 开发最佳实践**

| 无障碍需求 | 实现方式 | 优先级 |
|-----------|---------|-------|
| **颜色非唯一标识** | 表情符号 + ANSI颜色 双重编码 | P0 |
| **NO_COLOR 支持** | 检测环境变量，关闭所有ANSI颜色 | P0 |
| **表情符号回退** | 不支持 emoji 的终端自动使用 ASCII | P1 |
| **屏幕阅读器** | Claude Code 界面负责 ARIA，钩子仅输出纯文本 | 不适用 |
| **键盘操作** | 纯键盘操作，无额外依赖 | 已满足 |
| **闪烁/动画** | 无闪烁或动画内容 | 已满足 |

### Testing Strategy

| 类型 | 方法 | 频率 |
|------|------|------|
| **颜色渲染测试** | 在不同终端（macOS Terminal, iTerm2, VSCode terminal）验证颜色显示 | CI 每次提交 |
| **NO_COLOR 测试** | 设置 `NO_COLOR=1` 验证所有输出为纯文本 | CI 每次提交 |
| **宽屏截断测试** | 验证超长路径/消息被适当截断 | CI 每次提交 |
| **跨平台测试** | macOS + Linux 终端输出验证 | P0 发布前 |
| **自动化测试** | `bun test` 覆盖钩子的消息格式化函数 | CI 每次提交 |

### Implementation Guidelines

1. 所有消息格式化使用统一的 `formatMessage()` 工具函数（在 security-orchestrator.js 中）
2. 所有 ANSI 颜色通过 `colorize(text, 'red')` 函数封装，内置 NO_COLOR 检测
3. 表情符号使用 Unicode 码点而非直接输入（如 `\u{1F6AB}` 而非直接写 🚫）
4. 消息截断使用 `maxWidth` 参数，默认 80 字符
5. 日志文件始终输出结构化 JSON（不受 NO_COLOR 影响）
