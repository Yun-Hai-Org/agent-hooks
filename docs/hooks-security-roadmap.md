# Hooks 安全路线图（P3+）

当前仓库为 **hooks 库**；下列项在应用 monorepo / staging 就绪后接入。

## P3 — 可自动化

| 项            | 说明                                                   |
| ------------- | ------------------------------------------------------ |
| DAST          | `.github/workflows/dast.yml`（当前 stub，`if: false`） |
| SBOM          | Trivy/CycloneDX 每 release                             |
| 许可证合规    | Trivy license denylist                                 |
| 容器/IaC 扫描 | 有 Dockerfile/Terraform 后                             |
| API 安全测试  | OpenAPI + 越权负向用例                                 |
| 金融数据模式  | protect-secrets 扩展 PAN/身份证                        |

## P3+ — 流程合规

漏洞 SLA、签名 commit、审计留痕、第三方渗透（人工）。

## 架构扩展

应用 repo 可复用 `quality-gate.js --profile=full`，与 hooks 库本地三门并存。
