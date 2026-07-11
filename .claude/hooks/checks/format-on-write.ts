import { existsSync } from 'fs';
import { extname } from 'path';
import { execCommand, execCommandAsync, withTimeout } from '../security-orchestrator.js';
import { isGateNodeAutoFixEnabled, isGateNodeEnabled } from '../gate-config.js';
import { denyIfRuffMissing, getBunxInvocation, getRuffInvocation, isToolInstalled } from './tools.js';
import { hasStylelintConfig } from './file-patterns.js';
import { formatExtendedLintDenyOutput } from './extended-lint.js';

export interface FormatOnWriteResult {
  formatted: boolean;
  tools: string[];
  skipped: string[];
  errors: string[];
}

const PRETTIER_EXT = /\.(js|ts|jsx|tsx|mjs|cjs|json|md|mdx|yaml|yml|css|scss|less)$/i;
const MARKDOWN_EXT = /\.(md|mdx)$/i;
const SHELL_EXT = /\.(sh|bash|zsh)$/i;
const CSS_EXT = /\.(css|scss|less)$/i;
const SQL_EXT = /\.(sql)$/i;
const DOCKERFILE_NAME = /^Dockerfile$/i;

function isPrettierTarget(filePath: string): boolean {
  return PRETTIER_EXT.test(filePath) && !filePath.endsWith('.lock') && !filePath.includes('bun.lock');
}

function isDockerfilePath(filePath: string): boolean {
  const base = filePath.split('/').pop() ?? filePath;
  return DOCKERFILE_NAME.test(base) || base.toLowerCase().startsWith('dockerfile.');
}

export function classifyFormatOnWriteTarget(filePath: string): {
  prettier: boolean;
  markdownlint: boolean;
  ruff: boolean;
  shfmt: boolean;
  taplo: boolean;
  stylelint: boolean;
  shellcheck: boolean;
  hadolint: boolean;
  sqlfluff: boolean;
} {
  const ext = extname(filePath).toLowerCase();
  return {
    prettier: isPrettierTarget(filePath),
    markdownlint: MARKDOWN_EXT.test(filePath),
    ruff: ext === '.py',
    shfmt: SHELL_EXT.test(filePath),
    taplo: ext === '.toml',
    stylelint: CSS_EXT.test(filePath),
    shellcheck: SHELL_EXT.test(filePath),
    hadolint: isDockerfilePath(filePath),
    sqlfluff: SQL_EXT.test(filePath),
  };
}

function shouldAutoFixTool(tool: string, cwd: string): boolean {
  return isGateNodeAutoFixEnabled(`ide.format-on-write.checks.${tool}`, cwd);
}

function shouldLintTool(tool: string, cwd: string): boolean {
  return isGateNodeEnabled(`ide.format-on-write.checks.${tool}`, cwd);
}

export async function formatFileOnWrite(filePath: string, cwd?: string): Promise<FormatOnWriteResult> {
  const result: FormatOnWriteResult = { formatted: false, tools: [], skipped: [], errors: [] };
  if (!filePath || !existsSync(filePath)) {
    result.skipped.push('file-missing');
    return result;
  }

  const targets = classifyFormatOnWriteTarget(filePath);
  const hasAnyTarget = Object.values(targets).some(Boolean);
  if (!hasAnyTarget) {
    result.skipped.push('unsupported-extension');
    return result;
  }

  const repoCwd = cwd ?? process.cwd();

  if (targets.prettier) {
    if (!shouldAutoFixTool('prettier', repoCwd)) {
      result.skipped.push('prettier-autofix-disabled');
    } else if (!isToolInstalled('bun', repoCwd)) {
      result.skipped.push('prettier-bun-missing');
    } else {
      try {
        const bunx = getBunxInvocation(repoCwd);
        const prettierResult = await withTimeout(
          execCommandAsync(`${bunx} prettier --write "${filePath}"`, { cwd: repoCwd, timeout: 30000 }),
          30000,
          'prettier write 超时',
        );
        if (prettierResult.success) {
          result.tools.push('prettier');
          result.formatted = true;
        } else {
          result.errors.push((prettierResult.stderr || prettierResult.stdout).slice(0, 200));
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (targets.markdownlint) {
    if (!shouldAutoFixTool('markdownlint', repoCwd)) {
      result.skipped.push('markdownlint-autofix-disabled');
    } else if (!isToolInstalled('bun', repoCwd)) {
      result.skipped.push('markdownlint-bun-missing');
    } else {
      try {
        const bunx = getBunxInvocation(repoCwd);
        const mdResult = await withTimeout(
          execCommandAsync(`${bunx} markdownlint-cli2 --fix "${filePath}"`, { cwd: repoCwd, timeout: 60000 }),
          60000,
          'markdownlint fix 超时',
        );
        if (mdResult.success) {
          result.tools.push('markdownlint');
          result.formatted = true;
        } else {
          result.errors.push((mdResult.stderr || mdResult.stdout).slice(0, 200));
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (targets.ruff && execCommand('test -f pyproject.toml', { cwd: repoCwd }).success) {
    if (!shouldAutoFixTool('ruff', repoCwd)) {
      result.skipped.push('ruff-autofix-disabled');
    } else {
      const missing = denyIfRuffMissing('format-on-write-ruff', repoCwd);
      if (missing) {
        result.skipped.push('ruff-missing');
      } else {
        try {
          const ruff = getRuffInvocation(repoCwd);
          const ruffResult = await withTimeout(
            execCommandAsync(`${ruff} format "${filePath}"`, { cwd: repoCwd, timeout: 30000 }),
            30000,
            'ruff format 超时',
          );
          if (ruffResult.success) {
            result.tools.push('ruff');
            result.formatted = true;
          } else {
            result.errors.push((ruffResult.stderr || ruffResult.stdout).slice(0, 200));
          }
        } catch (e) {
          result.errors.push(e instanceof Error ? e.message : String(e));
        }
      }
    }
  }

  if (targets.shfmt) {
    if (!shouldAutoFixTool('shfmt', repoCwd)) {
      result.skipped.push('shfmt-autofix-disabled');
    } else if (!isToolInstalled('shfmt', repoCwd)) {
      result.skipped.push('shfmt-missing');
    } else {
      try {
        const shfmtResult = await withTimeout(
          execCommandAsync(`shfmt -w "${filePath}"`, { cwd: repoCwd, timeout: 30000 }),
          30000,
          'shfmt write 超时',
        );
        if (shfmtResult.success) {
          result.tools.push('shfmt');
          result.formatted = true;
        } else {
          result.errors.push((shfmtResult.stderr || shfmtResult.stdout).slice(0, 200));
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (targets.taplo) {
    if (!shouldAutoFixTool('taplo', repoCwd)) {
      result.skipped.push('taplo-autofix-disabled');
    } else if (!isToolInstalled('taplo', repoCwd)) {
      result.skipped.push('taplo-missing');
    } else {
      try {
        const taploResult = await withTimeout(
          execCommandAsync(`taplo format "${filePath}"`, { cwd: repoCwd, timeout: 30000 }),
          30000,
          'taplo format 超时',
        );
        if (taploResult.success) {
          result.tools.push('taplo');
          result.formatted = true;
        } else {
          result.errors.push((taploResult.stderr || taploResult.stdout).slice(0, 200));
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  // 仅 lint（不 fix）分支：stylelint / shellcheck / hadolint / sqlfluff
  // BEST-EFFORT：问题经 result.errors 汇总到 PostToolUse stderr 回显，不阻塞写入
  if (targets.stylelint) {
    if (!shouldLintTool('stylelint', repoCwd)) {
      result.skipped.push('stylelint-lint-disabled');
    } else if (!hasStylelintConfig(repoCwd)) {
      result.skipped.push('stylelint-no-config'); // F7 守卫
    } else if (!isToolInstalled('bun', repoCwd)) {
      result.skipped.push('stylelint-bun-missing'); // F5 守卫
    } else if (!isToolInstalled('stylelint', repoCwd)) {
      result.skipped.push('stylelint-pkg-missing'); // F5 守卫：缺 stylelint 包
    } else {
      try {
        const bunx = getBunxInvocation(repoCwd);
        const slResult = await withTimeout(
          execCommandAsync(`${bunx} stylelint --formatter=json "${filePath}"`, { cwd: repoCwd, timeout: 60000 }),
          60000,
          'stylelint lint 超时',
        );
        if (slResult.success) {
          result.tools.push('stylelint');
        } else {
          // --formatter=json 输出在 stdout；stderr 保留错误/配置问题
          const stdout = slResult.stdout || '';
          const stderr = slResult.stderr || '';
          if (
            stderr.includes('No configuration provided') ||
            stderr.includes('ConfigurationError') ||
            stdout.includes('No configuration provided') ||
            stdout.includes('ConfigurationError')
          ) {
            result.skipped.push('stylelint-no-config');
          } else {
            const rendered = formatExtendedLintDenyOutput('stylelint', stdout, filePath);
            result.errors.push(rendered);
          }
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (targets.shellcheck) {
    if (!shouldLintTool('shellcheck', repoCwd)) {
      result.skipped.push('shellcheck-lint-disabled');
    } else if (!isToolInstalled('shellcheck', repoCwd)) {
      result.skipped.push('shellcheck-missing'); // F5 守卫
    } else {
      try {
        const scResult = await withTimeout(
          execCommandAsync(`shellcheck "${filePath}"`, { cwd: repoCwd, timeout: 60000 }),
          60000,
          'shellcheck lint 超时',
        );
        if (scResult.success) {
          result.tools.push('shellcheck');
        } else {
          const output = scResult.stdout || scResult.stderr;
          const rendered = formatExtendedLintDenyOutput('shellcheck', output, filePath);
          result.errors.push(rendered);
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (targets.hadolint) {
    if (!shouldLintTool('hadolint', repoCwd)) {
      result.skipped.push('hadolint-lint-disabled');
    } else if (!isToolInstalled('hadolint', repoCwd)) {
      result.skipped.push('hadolint-missing'); // F5 守卫
    } else {
      try {
        const hdResult = await withTimeout(
          execCommandAsync(`hadolint "${filePath}"`, { cwd: repoCwd, timeout: 30000 }),
          30000,
          'hadolint lint 超时',
        );
        if (hdResult.success) {
          result.tools.push('hadolint');
        } else {
          const output = hdResult.stdout || hdResult.stderr;
          const rendered = formatExtendedLintDenyOutput('hadolint', output, filePath);
          result.errors.push(rendered);
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (targets.sqlfluff) {
    if (!shouldLintTool('sqlfluff', repoCwd)) {
      result.skipped.push('sqlfluff-lint-disabled');
    } else if (!isToolInstalled('sqlfluff', repoCwd)) {
      result.skipped.push('sqlfluff-missing'); // F5 守卫
    } else {
      try {
        const sqResult = await withTimeout(
          execCommandAsync(`sqlfluff lint "${filePath}" --dialect ansi`, { cwd: repoCwd, timeout: 60000 }),
          60000,
          'sqlfluff lint 超时',
        );
        if (sqResult.success) {
          result.tools.push('sqlfluff');
        } else {
          const output = sqResult.stdout || sqResult.stderr;
          const rendered = formatExtendedLintDenyOutput('sqlfluff', output, filePath);
          result.errors.push(rendered);
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  return result;
}
