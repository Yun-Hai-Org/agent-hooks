# 最严格质量配置模板

可复制到其他项目，作为「最严模式」的起点。

## 文件说明

| 文件                        | 用途                                            |
| --------------------------- | ----------------------------------------------- |
| `tsconfig.strict.json`      | TypeScript 最严编译选项                         |
| `eslint.strict.config.ts`   | ESLint strictTypeChecked + stylisticTypeChecked |
| `pyproject.strict.toml`     | Ruff select=ALL + pydocstyle + 圈复杂度         |
| `pyrightconfig.strict.json` | Pyright strict + 额外 report\* 规则             |

## 使用方法

```bash
# TypeScript
cp templates/strict-config/tsconfig.strict.json tsconfig.json
# 按需调整 include/exclude

# ESLint（Flat Config）
cp templates/strict-config/eslint.strict.config.ts eslint.config.ts

# Python
cat templates/strict-config/pyproject.strict.toml >> pyproject.toml
cp templates/strict-config/pyrightconfig.strict.json pyrightconfig.json
```

## 覆盖率渐进目标

- 当前实测基线：**~49.7%** 行覆盖（`DEFAULT_COVERAGE_THRESHOLD = 49`，由 `runHookUnitTests` 在 full 门解析判定）
- 下一阶段：**80%** → 最终 **100%**（随单测补充逐步 ratchet `DEFAULT_COVERAGE_THRESHOLD`）
- `bunfig.toml` 启用 `coverage = true`，但不设全局 `coverageThreshold`（避免对抗性/子集测试误失败）

### commit vs push 覆盖率检查

| 阶段         | Git hook / profile      | 覆盖率阈值                                       |
| ------------ | ----------------------- | ------------------------------------------------ |
| `git commit` | pre-commit / commit     | **不检查**（SKIP）                               |
| `git push`   | pre-push / full         | Lines + Functions ≥ `settings.coverageThreshold` |
| `git merge`  | pre-merge-commit / full | 同上                                             |

本地与 CI（`.github/workflows/test.yml`）可独立运行：`bun test --coverage`、`uv run pytest --cov=scripts/lib`、`bash scripts/run-shell-coverage.sh`（bats；未安装 kcov 时跳过 shell 覆盖率采集）。

## 已知副作用

- `noUncheckedIndexedAccess`：数组/索引访问需显式守卫
- `strictTypeChecked` ESLint：需补全类型，禁止 `any`
- Ruff `ALL`：可能触发大量 docstring/复杂度告警
- 工具缺失时质量门 **fail-closed**（DENY 而非 SKIP）
