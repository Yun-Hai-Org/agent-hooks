# Hooks 安全路线图（P3+）

## 已落地（hooks 库）

| 项            | 状态                                                             |
| ------------- | ---------------------------------------------------------------- |
| SBOM 归档     | `sbom-archive` merge-only，`.hooks/sbom/` + sha256 + index.jsonl |
| DAST (本地门) | `zap-api-dast` push/merge；需 OpenAPI + `ZAP_TARGET_URL`         |
| OPA/Conftest  | `opa-conftest`；`policy/` 或 `~/.claude/policy/`                 |
| IaC Checkov   | `iac-checkov`                                                    |
| Cosign/SLSA   | `slsa-cosign` merge-only；`.hooks/cosign/` 或 global fallback    |
| 审计导出      | merge 通过后 `.hooks/audit/{date}-{sha}.jsonl`                   |

## P3 — 待应用仓 / CI

| 项               | 说明                                                       |
| ---------------- | ---------------------------------------------------------- |
| CI DAST          | `.github/workflows/dast.yml`（workflow_dispatch + secret） |
| 许可证 denylist  | Trivy license 策略细化                                     |
| API 越权负向用例 | OpenAPI 驱动测试套件                                       |
| 金融数据模式     | protect-secrets 扩展 PAN/身份证                            |

## P3+ — 流程合规

漏洞 SLA、DefectDojo SARIF 聚合、第三方渗透（人工）。

## 架构扩展

应用 repo 复用 `quality-gate --profile=full`；全局 strict 默认 **fail-closed DENY**（缺失 policy/cosign 工具链即阻断，除无 OpenAPI 时 ZAP SKIP）。
