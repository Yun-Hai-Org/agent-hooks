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

- 初始基线：**80%** 行覆盖（由 `coverage.ts` 在 full 门解析判定）
- 目标：逐步 ratchet 到 **100%**
- `bunfig.toml` 不启用全局 `coverageThreshold`（避免对抗性/子集测试误失败）

## 已知副作用

- `noUncheckedIndexedAccess`：数组/索引访问需显式守卫
- `strictTypeChecked` ESLint：需补全类型，禁止 `any`
- Ruff `ALL`：可能触发大量 docstring/复杂度告警
- 工具缺失时质量门 **fail-closed**（DENY 而非 SKIP）
