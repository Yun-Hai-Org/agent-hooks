# Story 3.1: JSON/YAML Schema 增强

Status: done

## Story

As a **Claude Code 开发者**,
I want **保存 JSON/YAML 文件后自动 prettier 格式化并运行 check-jsonschema 验证**,
So that **JSON/YAML 文件格式一致且符合项目 Schema 约束**.

## Acceptance Criteria

1. **Given** Claude 写入 `.json` 文件
   **When** post-write-lint PostToolUse 钩子触发
   **Then** 运行 `prettier --write` 格式化 + `check-jsonschema` 验证
   **And** lint 输出包含文件路径、Schema 验证结果

2. **Given** Claude 写入 `.yaml` 或 `.yml` 文件
   **When** post-write-lint PostToolUse 钩子触发
   **Then** 运行 `prettier --write` 格式化 + `check-jsonschema` 验证
   **And** lint 输出包含文件路径、Schema 验证结果

3. **Given** 对应的 Schema 文件不存在（无 `.schema.json` 或 `$schema` 引用）
   **When** check-jsonschema 无法找到 schema
   **Then** 仅运行 prettier 格式化，Schema 验证跳过（fail-open）

4. **Given** prettier 或 check-jsonschema 未安装
   **When** lintJson/lintYaml 调用时工具不可用
   **Then** 已安装的工具继续执行，未安装的工具跳过（fail-open），输出 ⏭️ 消息

## Tasks / Subtasks

- [x] Task 1: 增强 lintJson() 函数 (AC: #1, #3, #4)
  - [x] Subtask 1.1: 添加 prettier --write 格式化（先执行，遵循 TS/JS 和 Markdown 模式）
  - [x] Subtask 1.2: 添加 check-jsonschema 验证（后执行，Schema 查找逻辑）
  - [x] Subtask 1.3: Schema 查找策略：文件内 `$schema` 字段 → 同目录 `.schema.json` → 跳过
  - [x] Subtask 1.4: 工具未安装时 fail-open（保留 jq 作为回退校验）
- [x] Task 2: 增强 lintYaml() 函数 (AC: #2, #3, #4)
  - [x] Subtask 2.1: 添加 prettier --write 格式化（先执行）
  - [x] Subtask 2.2: 添加 check-jsonschema --format yaml 验证（后执行）
  - [x] Subtask 2.3: Schema 查找策略：同 lintJson
  - [x] Subtask 2.4: 工具未安装时 fail-open（保留 yq 作为回退校验）
- [x] Task 3: 新增功能测试用例 (AC: #1, #2, #3, #4)
  - [x] Subtask 3.1: lintJson 增强测试（prettier 格式化、check-jsonschema 验证、Schema 查找）
  - [x] Subtask 3.2: lintYaml 增强测试（prettier 格式化、check-jsonschema 验证、Schema 查找）
  - [x] Subtask 3.3: fail-open 策略测试（工具未安装、Schema 不存在）
  - [x] Subtask 3.4: Schema 发现逻辑测试（$schema 字段、同目录 schema 文件）
- [x] Task 4: 运行全部测试验证
- [x] Task 5: 代码审查

## Dev Notes

### 实现要点

- lintJson() 当前位于 `.claude/hooks/post-write-lint.js` 第 213-228 行，使用 `jq empty` 校验
- lintYaml() 当前位于第 230-246 行，使用 `yq eval '.'` 校验
- 增强模式：保留 jq/yq 作为回退校验，新增 prettier 格式化 + check-jsonschema 验证
- 执行顺序：prettier 格式化 → check-jsonschema 验证 → jq/yq 回退校验

### Schema 查找策略

1. **文件内 `$schema` 字段**：读取 JSON 文件，检查 `$schema` 键指向的 URL/路径
2. **同目录 `.schema.json` 文件**：检查 `{fileDir}/{baseName}.schema.json`
3. **命名约定 schema**：检查项目根目录 `_schemas/` 或 `schemas/` 目录下匹配的 schema
4. **无 Schema**：跳过 check-jsonschema，仅执行 prettier + jq/yq 回退校验

对于 YAML 文件，check-jsonschema 使用 `--format yaml` 参数。

### 架构模式（从现有 lintXXX 函数遵循）

- 使用 `execCommand()` 执行外部命令（第 87-103 行）
- 使用 `which <tool>` 检测工具可用性
- 输出格式：emoji + 状态描述（✅ 通过 / ❌ 失败 / ⏭️ 跳过 / ⚠️ 警告）
- fail-open 策略：工具未安装时跳过并返回 true
- 文件写入后 prettier 可能修改文件内容，这是预期行为（格式化）

### 关键工具命令

```bash
# prettier 格式化 JSON
bunx prettier --write "${filePath}"

# prettier 格式化 YAML
bunx prettier --write --parser yaml "${filePath}"

# check-jsonschema 验证 JSON（自动检测 $schema）
bunx check-jsonschema --schemafile "${schemaPath}" "${filePath}"

# check-jsonschema 验证 YAML
bunx check-jsonschema --schemafile "${schemaPath}" --format yaml "${filePath}"

# jq 回退校验（已有）
jq empty "${filePath}"

# yq 回退校验（已有）
yq eval '.' "${filePath}" > /dev/null
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1]
- [Source: _bmad-output/planning-artifacts/prd.md#P1-1, P1-2]
- [Source: _bmad-output/planning-artifacts/architecture.md#P1 增量]
- [Source: .claude/hooks/post-write-lint.js#lintJson, lintYaml]

## Dev Agent Record

### Agent Model Used

MiMo-v2.5-pro

### Debug Log References

### Completion Notes List

- 所有 4 个 AC 均已验证通过
- lintJson(): prettier 格式化 → check-jsonschema 验证 → jq 回退校验
- lintYaml(): prettier --parser yaml → check-jsonschema --format yaml → yq 回退校验
- findSchemaFile(): 3 层 Schema 查找策略（$schema 字段 → 同目录 .schema.json → 项目 schemas/ 目录）
- runCheckJsonschema(): fail-open（schema 缺失或工具未安装时跳过）
- 测试: 152 pass / 0 fail / 200 expect() calls

### File List

- .claude/hooks/post-write-lint.js (lintJson, lintYaml, findSchemaFile, runCheckJsonschema)
- .claude/hooks/**tests**/post-write-lint.test.js (findSchemaFile, runCheckJsonschema, lintJson, lintYaml 测试)
