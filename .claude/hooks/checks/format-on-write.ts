import { existsSync } from 'fs';
import { extname } from 'path';
import { execCommand, execCommandAsync, withTimeout } from '../security-orchestrator.js';
import { isGateNodeAutoFixEnabled } from '../gate-config.js';
import { denyIfRuffMissing, getBunxInvocation, getRuffInvocation, isToolInstalled } from './tools.js';

export interface FormatOnWriteResult {
  formatted: boolean;
  tools: string[];
  skipped: string[];
  errors: string[];
}

const PRETTIER_EXT = /\.(js|ts|jsx|tsx|mjs|cjs|json|md|mdx|yaml|yml|css|scss|less)$/i;
const MARKDOWN_EXT = /\.(md|mdx)$/i;
const SHELL_EXT = /\.(sh|bash|zsh)$/i;

function isPrettierTarget(filePath: string): boolean {
  return PRETTIER_EXT.test(filePath) && !filePath.endsWith('.lock') && !filePath.includes('bun.lock');
}

export function classifyFormatOnWriteTarget(filePath: string): {
  prettier: boolean;
  markdownlint: boolean;
  ruff: boolean;
  shfmt: boolean;
  taplo: boolean;
} {
  const ext = extname(filePath).toLowerCase();
  return {
    prettier: isPrettierTarget(filePath),
    markdownlint: MARKDOWN_EXT.test(filePath),
    ruff: ext === '.py',
    shfmt: SHELL_EXT.test(filePath),
    taplo: ext === '.toml',
  };
}

function shouldAutoFixTool(tool: string, cwd: string): boolean {
  return isGateNodeAutoFixEnabled(`ide.format-on-write.checks.${tool}`, cwd);
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

  return result;
}
