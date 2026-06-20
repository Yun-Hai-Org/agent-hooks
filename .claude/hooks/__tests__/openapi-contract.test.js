import { describe, it, expect } from 'bun:test';
import {
  isOpenApiSpecCandidatePath,
  isOpenApiSpecExcludedPath,
  isOpenApiSpecPath,
  looksLikeOpenApiSpecContent,
} from '../checks/file-patterns.js';
import { hasOpenApiBaseline, runOpenApiContractStaged, runOpenApiContractFull } from '../checks/openapi-contract.js';
import { DECISION } from '../security-orchestrator.js';
import { getToolInstallHint } from '../checks/tools.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('openapi-contract', () => {
  describe('file-patterns', () => {
    it('isOpenApiSpecCandidatePath 应识别常见 OpenAPI 路径', () => {
      expect(isOpenApiSpecCandidatePath('openapi.yaml')).toBe(true);
      expect(isOpenApiSpecCandidatePath('docs/swagger.json')).toBe(true);
      expect(isOpenApiSpecCandidatePath('api/openapi.yml')).toBe(true);
      expect(isOpenApiSpecCandidatePath('api-docs/openapi.yaml')).toBe(true);
    });

    it('应排除 _bmad 与 CI 配置', () => {
      expect(isOpenApiSpecExcludedPath('_bmad/foo/openapi.yaml')).toBe(true);
      expect(isOpenApiSpecExcludedPath('.github/workflows/ci.yml')).toBe(true);
      expect(isOpenApiSpecCandidatePath('_bmad/openapi.yaml')).toBe(false);
    });

    it('looksLikeOpenApiSpecContent 应识别 OpenAPI 3 内容', () => {
      const content = 'openapi: 3.0.3\ninfo:\n  title: API\n';
      expect(looksLikeOpenApiSpecContent(content)).toBe(true);
      expect(looksLikeOpenApiSpecContent('name: app\n')).toBe(false);
    });

    it('isOpenApiSpecPath 对 openapi.yaml 无需内容嗅探', () => {
      expect(isOpenApiSpecPath('openapi.yaml')).toBe(true);
    });
  });

  describe('hasOpenApiBaseline', () => {
    it('非 git 目录应返回 false', () => {
      expect(hasOpenApiBaseline('openapi.yaml', '/tmp')).toBe(false);
    });
  });

  describe('runOpenApiContractStaged', () => {
    it('非 git 目录或无 OpenAPI 文件时应 SKIP', async () => {
      const result = await runOpenApiContractStaged('/tmp');
      expect(result.decision).toBe(DECISION.SKIP);
      expect(result.checkId).toBe('openapi-staged');
    });
  });

  describe('runOpenApiContractFull', () => {
    it('仓库无 OpenAPI spec 时应 SKIP', async () => {
      const result = await runOpenApiContractFull(process.cwd());
      expect(result.decision).toBe(DECISION.SKIP);
      expect(result.checkId).toBe('openapi-full');
    });
  });

  describe('quality-gate wiring', () => {
    it('quality-gate 应接入 openapi-contract 检查', () => {
      const source = readFileSync(join(import.meta.dir, '..', 'quality-gate.js'), 'utf-8');
      expect(source).toContain('runOpenApiContractStaged(cwd)');
      expect(source).toContain('runOpenApiContractFull(cwd)');
    });
  });

  describe('tools', () => {
    it('getToolInstallHint 应包含 oasdiff', () => {
      expect(getToolInstallHint('oasdiff')).toContain('oasdiff');
    });
  });
});
