import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyFiles,
  isDockerComposePath,
  isDockerfilePath,
  isK8sManifestCandidatePath,
} from '../checks/file-patterns.js';
import {
  HADOLINT_SECURITY_RULES,
  getHadolintSeverity,
  parseHadolintOutput,
  runExtendedLintStaged,
  runExtendedLintFull,
} from '../checks/extended-lint.js';
import { DECISION } from '../security-orchestrator.js';
import { getToolInstallHint } from '../checks/tools.js';

describe('extended-lint', () => {
  describe('file-patterns', () => {
    it('isDockerfilePath 应识别 Dockerfile/Containerfile/.dockerfile', () => {
      expect(isDockerfilePath('Dockerfile')).toBe(true);
      expect(isDockerfilePath('Containerfile')).toBe(true);
      expect(isDockerfilePath('docker/dev.dockerfile')).toBe(true);
      expect(isDockerfilePath('src/index.js')).toBe(false);
    });

    it('isDockerComposePath 应识别 compose 文件并排除 override', () => {
      expect(isDockerComposePath('docker-compose.yml')).toBe(true);
      expect(isDockerComposePath('docker-compose.prod.yaml')).toBe(true);
      expect(isDockerComposePath('compose.yml')).toBe(true);
      expect(isDockerComposePath('docker-compose.override.yml')).toBe(false);
      expect(isDockerComposePath('k8s/deployment.yaml')).toBe(false);
    });

    it('isK8sManifestCandidatePath 应识别 K8s 路径', () => {
      expect(isK8sManifestCandidatePath('k8s/deployment.yaml')).toBe(true);
      expect(isK8sManifestCandidatePath('docker-compose.yml')).toBe(false);
      expect(isK8sManifestCandidatePath('.github/workflows/ci.yml')).toBe(false);
    });

    it('classifyFiles 应按扩展名分类', () => {
      const files = [
        'README.md',
        'scripts/deploy.sh',
        'Dockerfile',
        'docker-compose.yml',
        'pyproject.toml',
        'query.sql',
        'styles/app.css',
        'config.json',
        'config.yaml',
      ];
      const c = classifyFiles(files);
      expect(c.md).toEqual(['README.md']);
      expect(c.shell).toEqual(['scripts/deploy.sh']);
      expect(c.docker).toEqual(['Dockerfile']);
      expect(c.compose).toEqual(['docker-compose.yml']);
      expect(c.toml).toEqual(['pyproject.toml']);
      expect(c.sql).toEqual(['query.sql']);
      expect(c.css).toEqual(['styles/app.css']);
      expect(c.json).toEqual(['config.json']);
      expect(c.yaml).toEqual(['config.yaml']);
    });
  });

  describe('HADOLINT_SECURITY_RULES', () => {
    it('应包含 HIGH 级别安全规则', () => {
      expect(HADOLINT_SECURITY_RULES.DL3006).toBe('HIGH');
      expect(HADOLINT_SECURITY_RULES.DL3023).toBe('HIGH');
      expect(HADOLINT_SECURITY_RULES.DL3002).toBe('HIGH');
    });

    it('未定义规则不在映射中', () => {
      expect(HADOLINT_SECURITY_RULES['DL9999']).toBeUndefined();
    });
  });

  describe('getHadolintSeverity', () => {
    it('hadolint error 应返回 CRITICAL', () => {
      expect(getHadolintSeverity('error', 'DL3006')).toBe('CRITICAL');
    });

    it('hadolint warning + 安全规则应返回 HIGH', () => {
      expect(getHadolintSeverity('warning', 'DL3006')).toBe('HIGH');
    });

    it('hadolint warning + 未定义规则应返回 HIGH', () => {
      expect(getHadolintSeverity('warning', 'DL9999')).toBe('HIGH');
    });

    it('hadolint info 应返回 MEDIUM', () => {
      expect(getHadolintSeverity('info', 'DL9999')).toBe('MEDIUM');
    });
  });

  describe('parseHadolintOutput', () => {
    it('应解析标准 hadolint 输出', () => {
      const output = 'Dockerfile:1:2: DL3006 warning: Always tag the version of an image explicitly';
      const results = parseHadolintOutput(output);
      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('Dockerfile');
      expect(results[0].line).toBe(1);
      expect(results[0].ruleId).toBe('DL3006');
      expect(results[0].severity).toBe('HIGH');
    });

    it('应解析多行输出', () => {
      const output = [
        'Dockerfile:1:2: DL3006 warning: Always tag the version of an image explicitly',
        'Dockerfile:3:1: DL3023 warning: COPY --chown is recommended for security',
      ].join('\n');
      expect(parseHadolintOutput(output)).toHaveLength(2);
    });

    it('error 级别应映射为 CRITICAL', () => {
      const output = 'Dockerfile:1:2: DL3006 error: Always tag the version of an image explicitly';
      expect(parseHadolintOutput(output)[0].severity).toBe('CRITICAL');
    });

    it('空输出应返回空数组', () => {
      expect(parseHadolintOutput('')).toHaveLength(0);
    });
  });

  describe('runExtendedLintStaged', () => {
    it('非 git 目录或无暂存文件时应 SKIP', async () => {
      const result = await runExtendedLintStaged('/tmp');
      expect(result.decision).toBe(DECISION.SKIP);
      expect(result.checkId).toBe('extended-staged');
    });
  });

  describe('runExtendedLintFull', () => {
    it('非 git 目录应 SKIP', async () => {
      const result = await runExtendedLintFull('/tmp');
      expect(result.decision).toBe(DECISION.SKIP);
    });
  });

  describe('工具安装指引', () => {
    it('扩展 lint 工具应有安装 hint', () => {
      expect(getToolInstallHint('shellcheck')).toContain('shellcheck');
      expect(getToolInstallHint('hadolint')).toContain('hadolint');
      expect(getToolInstallHint('docker')).toContain('docker');
      expect(getToolInstallHint('taplo')).toContain('taplo');
      expect(getToolInstallHint('sqlfluff')).toContain('sqlfluff');
    });
  });

  describe('extended-lint 源码', () => {
    it('应使用 sqlfluff --dialect ansi', () => {
      const sourceFile = join(import.meta.dir, '..', 'checks', 'extended-lint.ts');
      const content = readFileSync(sourceFile, 'utf-8');
      expect(content).toContain('sqlfluff lint');
      expect(content).toContain('--dialect ansi');
    });

    it('应包含 docker compose config 校验', () => {
      const sourceFile = join(import.meta.dir, '..', 'checks', 'extended-lint.ts');
      const content = readFileSync(sourceFile, 'utf-8');
      expect(content).toContain('docker compose -f');
      expect(content).toContain('config --quiet');
    });

    it('shell 检查块内应先 shfmt 后 shellcheck', () => {
      const sourceFile = join(import.meta.dir, '..', 'checks', 'extended-lint.ts');
      const content = readFileSync(sourceFile, 'utf-8');
      const shellBlock = content.indexOf('if (classified.shell.length > 0)');
      expect(shellBlock).toBeGreaterThan(0);
      const shfmtPos = content.indexOf('shfmt -d ${files}', shellBlock);
      const shellcheckPos = content.indexOf('shellcheck ${files}', shellBlock);
      expect(shfmtPos).toBeGreaterThan(0);
      expect(shellcheckPos).toBeGreaterThan(shfmtPos);
    });
  });
});
