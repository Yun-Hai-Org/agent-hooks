import { describe, it, expect } from 'bun:test';
import {
  isDockerComposePath,
  isK8sManifestCandidatePath,
  isK8sManifestPath,
  looksLikeK8sManifestContent,
} from '../checks/file-patterns.js';
import {
  parseKubeconformSummary,
  parseKubeLinterDiagnostics,
  runK8sLintStaged,
  runK8sLintFull,
} from '../checks/k8s-lint.js';
import { DECISION } from '../security-orchestrator.js';
import { getToolInstallHint } from '../checks/tools.js';

describe('k8s-lint', () => {
  describe('file-patterns', () => {
    it('isK8sManifestCandidatePath 应识别常见 K8s 路径', () => {
      expect(isK8sManifestCandidatePath('k8s/deployment.yaml')).toBe(true);
      expect(isK8sManifestCandidatePath('kubernetes/service.yml')).toBe(true);
      expect(isK8sManifestCandidatePath('charts/templates/deployment.yaml')).toBe(true);
      expect(isK8sManifestCandidatePath('deployment.yaml')).toBe(true);
    });

    it('应排除 compose 与 CI 配置', () => {
      expect(isK8sManifestCandidatePath('docker-compose.yml')).toBe(false);
      expect(isK8sManifestCandidatePath('.github/workflows/ci.yml')).toBe(false);
      expect(isDockerComposePath('docker-compose.override.yml')).toBe(false);
    });

    it('looksLikeK8sManifestContent 应识别 manifest 内容', () => {
      const content = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app\n';
      expect(looksLikeK8sManifestContent(content)).toBe(true);
      expect(looksLikeK8sManifestContent('name: app\n')).toBe(false);
    });

    it('isK8sManifestPath 对 k8s 目录文件无需内容嗅探', () => {
      expect(isK8sManifestPath('k8s/deployment.yaml')).toBe(true);
    });
  });

  describe('parseKubeconformSummary', () => {
    it('应解析 kubeconform JSON summary', () => {
      const output = JSON.stringify({ summary: { resources_invalid: 1, resources_valid: 2, resources_scanned: 3 } });
      const summary = parseKubeconformSummary(output);
      expect(summary?.invalid).toBe(1);
      expect(summary?.valid).toBe(2);
      expect(summary?.total).toBe(3);
    });

    it('无效 JSON 应返回 null', () => {
      expect(parseKubeconformSummary('not json')).toBeNull();
    });
  });

  describe('parseKubeLinterDiagnostics', () => {
    it('应区分 error 与 warning', () => {
      const output = JSON.stringify({
        reports: [
          {
            diagnostics: [
              { severity: 'error', check: 'no-ros', message: 'missing runAsNonRoot' },
              { severity: 'warning', check: 'latest-tag', message: 'use explicit tag' },
            ],
          },
        ],
      });
      const { errors, warnings } = parseKubeLinterDiagnostics(output);
      expect(errors).toHaveLength(1);
      expect(warnings).toHaveLength(1);
    });
  });

  describe('runK8sLintStaged', () => {
    it('非 git 目录或无 K8s 文件时应 SKIP', async () => {
      const result = await runK8sLintStaged('/tmp');
      expect(result.decision).toBe(DECISION.SKIP);
      expect(result.checkId).toBe('k8s-staged');
    });
  });

  describe('runK8sLintFull', () => {
    it('非 git 目录应 SKIP', async () => {
      const result = await runK8sLintFull('/tmp');
      expect(result.decision).toBe(DECISION.SKIP);
      expect(result.checkId).toBe('k8s-full');
    });
  });

  describe('工具安装指引', () => {
    it('K8s 工具应有安装 hint', () => {
      expect(getToolInstallHint('kubeconform')).toContain('kubeconform');
      expect(getToolInstallHint('kube-linter')).toContain('kube-linter');
    });
  });
});
