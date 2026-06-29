# Hooks 安全路线图（P3+）

## 已落地（hooks 库）

| 项              | 状态                                                              |
| --------------- | ----------------------------------------------------------------- |
| SBOM 归档       | `sbom-archive` merge-only，`.hooks/sbom/` + sha256 + index.jsonl  |
| DAST (本地门)   | `zap-api-dast` push/merge；需 OpenAPI + `ZAP_TARGET_URL`          |
| OPA/Conftest    | `opa-conftest`；`policy/` 或 `~/.claude/policy/`                  |
| IaC Checkov     | `iac-checkov`                                                     |
| Cosign/SLSA     | `slsa-cosign` merge-only；`.hooks/cosign/` 或 global fallback     |
| 审计导出        | merge 通过后 `.hooks/audit/{date}-{sha}.jsonl` + SARIF + manifest |
| 许可证 denylist | `settings.licenseDenylist` → Trivy license 匹配 DENY              |
| API 越权负向    | `openapi-auth-negative`；yaml 用例 + `ZAP_TARGET_URL` / `baseUrl` |
| 双覆盖率门禁    | `settings.coverageThreshold` lines/functions ≥80 @ push/merge     |
| scanScope       | semgrep/trivy/sbom/payment-page/checkov 路径过滤                  |

## P3 — CI / 应用仓

| 项           | 说明                                                        |
| ------------ | ----------------------------------------------------------- |
| CI DAST      | `.github/workflows/dast.yml`（ZAP + openapi-auth-negative） |
| 金融数据模式 | protect-secrets 扩展 PAN/身份证                             |

## P3+ — 流程合规（未纳入 hooks 库）

漏洞 SLA、DefectDojo SARIF 聚合、第三方渗透（人工）、外部 GRC/S3 归档。

## 架构扩展

应用 repo 复用 `quality-gate --profile=full`；全局 strict 默认 **fail-closed DENY**（缺失 policy/cosign 工具链即阻断，除无 OpenAPI 时 ZAP SKIP）。
