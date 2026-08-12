import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';
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
  parseMarkdownlintOutput,
  parseStylelintOutput,
  parseShellcheckOutput,
  parseSqlfluffOutput,
  formatExtendedLintDenyOutput,
  runExtendedLintStaged,
  runExtendedLintFull,
} from '../checks/extended-lint.js';
import { DECISION } from '../security-orchestrator.js';
import { getToolInstallHint } from '../checks/tools.js';
import { isGateNodeAutoFixEnabled } from '../gate-config.js';
import { buildGateCheckPath } from '../gate-autofix.js';

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

    it('暂存 Dockerfile 时执行 hadolint 路径', async () => {
      const repo = createTempGitRepo('feat/ext-staged');
      try {
        writeFileSync(join(repo, 'Dockerfile'), 'FROM alpine\n');
        execSync('git add Dockerfile', { cwd: repo });
        const result = await runExtendedLintStaged(repo);
        expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(result.decision);
      } finally {
        cleanupTempGitRepo(repo);
      }
    }, 120_000);
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

    it('应包含 container runtime compose config 校验', () => {
      const sourceFile = join(import.meta.dir, '..', 'checks', 'extended-lint.ts');
      const content = readFileSync(sourceFile, 'utf-8');
      expect(content).toContain('getComposeConfigCmd');
      expect(content).toContain('denyIfContainerRuntimeMissing');
      expect(content).toContain('resolveContainerRuntime');
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

    it('runExtendedLintStaged 应使用 getScopedStagedFiles', () => {
      const sourceFile = join(import.meta.dir, '..', 'checks', 'extended-lint.ts');
      const content = readFileSync(sourceFile, 'utf-8');
      expect(content).toContain('getScopedStagedFiles');
      const stagedFn = content.indexOf('export async function runExtendedLintStaged');
      expect(stagedFn).toBeGreaterThanOrEqual(0);
      const stagedBody = content.slice(stagedFn, stagedFn + 500);
      expect(stagedBody).toContain('getScopedStagedFiles');
      expect(stagedBody).not.toMatch(/\bgetStagedFiles\b/);
    });
  });

  describe('parseMarkdownlintOutput', () => {
    it('应剥离 banner 并解析真实 markdownlint-cli2 v0.22.1 输出', () => {
      const output = [
        'markdownlint-cli2 v0.22.1 (markdownlint-cli2)',
        'Finding: mdtest.md',
        'Linting: 1 file(s)',
        'Summary: 1 error(s)',
        'mdtest.md:1:26 error MD009/no-trailing-spaces Trailing spaces [Expected: 0 or 2; Actual: 3]',
      ].join('\n');
      const results = parseMarkdownlintOutput(output);
      expect(results).toHaveLength(1);
      const r = results[0];
      expect(r.file).toBe('mdtest.md');
      expect(r.line).toBe(1);
      expect(r.column).toBe(26);
      expect(r.severity).toBe('ERROR');
      expect(r.ruleId).toBe('MD009');
      expect(r.message).toContain('Trailing spaces');
    });

    it('多违规应全部解析且不混入 banner 行', () => {
      const output = [
        'markdownlint-cli2 v0.22.1',
        'Finding: a.md b.md',
        'Linting: 2 file(s)',
        'Summary: 3 error(s)',
        'a.md:1:1 error MD041/first-line-heading/first-line-h1 First line should be a top-level heading',
        'b.md:3:5 warning MD012/no-multiple-blanks Multiple consecutive blank lines [Expected: 1; Actual: 2]',
      ].join('\n');
      const results = parseMarkdownlintOutput(output);
      expect(results).toHaveLength(2);
      expect(results[0].ruleId).toBe('MD041');
      expect(results[0].severity).toBe('ERROR');
      expect(results[1].ruleId).toBe('MD012');
      expect(results[1].severity).toBe('WARN');
    });

    it('应解析无列号的 MD041 真实输出（file:line error MDxxx/...）', () => {
      const output = 'a.md:1 error MD041/first-line-heading/first-line-h1 First line should be a top-level heading [Context: "x"]';
      const results = parseMarkdownlintOutput(output);
      expect(results).toHaveLength(1);
      expect(results[0].line).toBe(1);
      expect(results[0].column).toBeUndefined();
      expect(results[0].ruleId).toBe('MD041');
    });

    it('空输出应返回空数组', () => {
      expect(parseMarkdownlintOutput('')).toHaveLength(0);
    });

    it('formatExtendedLintDenyOutput 渲染时剥离前导 error/warning token', () => {
      const output = 'mdtest.md:1:26 error MD009/no-trailing-spaces Trailing spaces [Expected: 0 or 2; Actual: 3]';
      const rendered = formatExtendedLintDenyOutput('markdownlint', output);
      expect(rendered).toContain('MD009');
      expect(rendered).toContain('mdtest.md:1');
      expect(rendered).not.toMatch(/^error\s/);
    });
  });

  describe('parseStylelintOutput', () => {
    it('应解析 stylelint --formatter=json 输出', () => {
      const output = JSON.stringify([
        {
          source: 'styles.css',
          warnings: [
            {
              line: 1,
              column: 2,
              rule: 'color-no-invalid-hex',
              text: 'Invalid hex color "#xxx" (color-no-invalid-hex)',
            },
          ],
        },
      ]);
      const results = parseStylelintOutput(output);
      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('styles.css');
      expect(results[0].line).toBe(1);
      expect(results[0].ruleId).toBe('color-no-invalid-hex');
    });
  });

  describe('parseShellcheckOutput', () => {
    it('应解析 `script.sh:1:1: note: ... [SC2155]` 格式', () => {
      const output = 'deploy.sh:1:1: note: Declare and assign separately to avoid masking return values. [SC2155]';
      const results = parseShellcheckOutput(output);
      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('deploy.sh');
      expect(results[0].line).toBe(1);
      expect(results[0].ruleId).toBe('SC2155');
      expect(results[0].severity).toBe('NOTE');
    });
  });

  describe('parseSqlfluffOutput', () => {
    it('应解析 `L:   1 | P:   7 | LT01 | ...` 管道格式', () => {
      const output = 'L:   1 | P:   7 | LT01 | Expected only single space before naked identifier.';
      const results = parseSqlfluffOutput(output);
      expect(results).toHaveLength(1);
      expect(results[0].line).toBe(1);
      expect(results[0].column).toBe(7);
      expect(results[0].ruleId).toBe('LT01');
      expect(results[0].message).toContain('single space');
    });
  });

  describe('buildGateCheckPath / autoFix 配置（F2）', () => {
    it('buildGateCheckPath 应拼出无双重 .checks 的完整路径', () => {
      expect(buildGateCheckPath('git.pre-commit', 'lint-staged-markdownlint')).toBe(
        'git.pre-commit.checks.lint-staged-markdownlint',
      );
    });

    it('项目仓库内 markdownlint autoFix 应被启用', () => {
      const cwd = process.cwd();
      const path = buildGateCheckPath('git.pre-commit', 'lint-staged-markdownlint');
      expect(isGateNodeAutoFixEnabled(path, cwd)).toBe(true);
    });
  });

  describe('formatExtendedLintDenyOutput（统一渲染器）', () => {
    it('对 shellcheck 应渲染为 `[shellcheck][级别] SCxxx:文件:行 — 消息`', () => {
      const output = 'deploy.sh:1:1: note: Declare and assign separately. [SC2155]';
      const rendered = formatExtendedLintDenyOutput('shellcheck', output, 'deploy.sh');
      expect(rendered).toContain('[shellcheck]');
      expect(rendered).toContain('SC2155');
      expect(rendered).toContain(':deploy.sh:1');
    });

    it('sqlfluff 渲染应携带文件名', () => {
      const output = 'L:   1 | P:   7 | LT01 | Expected only single space before naked identifier.';
      const rendered = formatExtendedLintDenyOutput('sqlfluff', output, 'query.sql');
      expect(rendered).toContain('[sqlfluff]');
      expect(rendered).toContain('LT01');
      expect(rendered).toContain(':query.sql:1');
    });

    it('未知工具应回退到截断原始输出', () => {
      const rendered = formatExtendedLintDenyOutput('unknown-tool', 'something went wrong');
      expect(rendered).toBe('something went wrong');
    });
  });

  describe('denyOnToolError（F10 窄化）', () => {
    it('无 execResult 时退回 `工具执行失败: <msg>`', async () => {
      const { denyOnToolError } = await import('../checks/tools.js');
      const result = denyOnToolError(new Error('boom'), 'lint-staged-markdownlint', 'markdownlint');
      expect(result.decision).toBe(DECISION.DENY);
      expect(result.message).toContain('markdownlint 执行失败');
      expect(result.message).toContain('boom');
    });

    it('裸字符串错误也能渲染', async () => {
      const { denyOnToolError } = await import('../checks/tools.js');
      const result = denyOnToolError('string error', 'lint-staged-shellcheck', 'shellcheck');
      expect(result.message).toContain('shellcheck 执行失败');
      expect(result.message).toContain('string error');
    });
  });
});
