import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from './security-orchestrator.js';
import { isGateNodeAutoFixEnabled } from './gate-config.js';
import { nodeSupportsAutoFix } from './gate-registry.js';
import { gateTimeoutMessage } from './gate-timeouts.js';
import { getBunxInvocation, getRuffInvocation } from './checks/tools.js';
import type { CheckResult } from './types.js';

export interface AutoFixContext {
  cwd: string;
  files?: string[];
  timeoutMs?: number;
}

export interface FixResult {
  success: boolean;
  error?: string;
}

const DEFAULT_FIX_TIMEOUT_MS = 60_000;

function resolveFixTimeout(ctx: AutoFixContext): number {
  return ctx.timeoutMs ?? DEFAULT_FIX_TIMEOUT_MS;
}

function quoteFiles(files: string[] | undefined): string {
  return (files ?? []).map((f) => `"${f}"`).join(' ');
}

/**
 * fixer 改写工作树后需 `git add` 受影响文件，否则提交门提交的 blob 仍是未修复版本（F9）。
 * 仅 re-stage 显式传入的文件，避免误把无关暂存变更卷入。
 */
function restageFixedFiles(ctx: AutoFixContext): void {
  const files = ctx.files ?? [];
  if (files.length === 0) return;
  const addResult = execCommand(`git add -- ${files.map((f) => `"${f}"`).join(' ')}`, { cwd: ctx.cwd });
  if (!addResult.success) {
    // re-stage 失败不视为 fixer 失败（commit 门会在最终结果中再次拦截），仅作日志可见
  }
}

async function runFixCommand(command: string, ctx: AutoFixContext, label: string): Promise<FixResult> {
  const timeoutMs = resolveFixTimeout(ctx);
  try {
    const result = await withTimeout(
      execCommandAsync(command, { cwd: ctx.cwd, timeout: timeoutMs }),
      timeoutMs,
      gateTimeoutMessage(label, timeoutMs),
    );
    if (result.success) {
      restageFixedFiles(ctx);
      return { success: true };
    }
    return { success: false, error: (result.stderr || result.stdout).slice(0, 500) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fixPrettier(ctx: AutoFixContext): Promise<FixResult> {
  const files = quoteFiles(ctx.files);
  if (!files) return { success: false, error: '无 prettier 目标文件' };
  return runFixCommand(`${getBunxInvocation(ctx.cwd)} prettier --write ${files}`, ctx, 'prettier fix');
}

async function fixMarkdownlint(ctx: AutoFixContext): Promise<FixResult> {
  const files = quoteFiles(ctx.files);
  if (!files) return { success: false, error: '无 markdownlint 目标文件' };
  return runFixCommand(`${getBunxInvocation(ctx.cwd)} markdownlint-cli2 --fix ${files}`, ctx, 'markdownlint fix');
}

async function fixRuffFormat(ctx: AutoFixContext): Promise<FixResult> {
  const ruff = getRuffInvocation(ctx.cwd);
  if (ctx.files && ctx.files.length > 0) {
    return runFixCommand(`${ruff} format ${quoteFiles(ctx.files)}`, ctx, 'ruff format fix');
  }
  return runFixCommand(`${ruff} format .`, ctx, 'ruff format fix');
}

async function fixRuffLint(ctx: AutoFixContext): Promise<FixResult> {
  const ruff = getRuffInvocation(ctx.cwd);
  if (ctx.files && ctx.files.length > 0) {
    return runFixCommand(`${ruff} check --fix --preview ${quoteFiles(ctx.files)}`, ctx, 'ruff lint fix');
  }
  return runFixCommand(`${ruff} check --fix --preview .`, ctx, 'ruff lint fix');
}

async function fixShfmt(ctx: AutoFixContext): Promise<FixResult> {
  const files = quoteFiles(ctx.files);
  if (!files) return { success: false, error: '无 shfmt 目标文件' };
  return runFixCommand(`shfmt -w ${files}`, ctx, 'shfmt fix');
}

async function fixTaplo(ctx: AutoFixContext): Promise<FixResult> {
  const files = quoteFiles(ctx.files);
  if (!files) return { success: false, error: '无 taplo 目标文件' };
  return runFixCommand(`taplo format ${files}`, ctx, 'taplo fix');
}

async function fixEslint(ctx: AutoFixContext): Promise<FixResult> {
  const ruff = getBunxInvocation(ctx.cwd);
  if (ctx.files && ctx.files.length > 0) {
    return runFixCommand(
      `${ruff} eslint ${quoteFiles(ctx.files)} --fix --max-warnings 0 --no-warn-ignored --report-unused-disable-directives`,
      ctx,
      'eslint fix',
    );
  }
  return runFixCommand(
    `${ruff} eslint .claude/hooks --ignore-pattern "**/__tests__/**" --fix --max-warnings 0 --report-unused-disable-directives`,
    ctx,
    'eslint fix',
  );
}

async function fixStylelint(ctx: AutoFixContext): Promise<FixResult> {
  const files = quoteFiles(ctx.files);
  if (!files) return { success: false, error: '无 stylelint 目标文件' };
  return runFixCommand(`${getBunxInvocation(ctx.cwd)} stylelint --fix ${files}`, ctx, 'stylelint fix');
}

async function fixSqlfluff(ctx: AutoFixContext): Promise<FixResult> {
  const files = ctx.files ?? [];
  if (files.length === 0) return { success: false, error: '无 sqlfluff 目标文件' };
  for (const file of files) {
    const result = await runFixCommand(`sqlfluff fix "${file}" --dialect ansi`, ctx, 'sqlfluff fix');
    if (!result.success) return result;
  }
  return { success: true };
}

/** 按 gate path 末段 check id 映射 fix 行为 */
export const FIX_COMMANDS: Record<string, (ctx: AutoFixContext) => Promise<FixResult>> = {
  prettier: fixPrettier,
  markdownlint: fixMarkdownlint,
  ruff: fixRuffFormat,
  shfmt: fixShfmt,
  taplo: fixTaplo,
  'lint-staged-eslint': fixEslint,
  'lint-eslint': fixEslint,
  'lint-staged-ruff': fixRuffLint,
  'lint-ruff': fixRuffLint,
  'lint-staged-markdownlint': fixMarkdownlint,
  'lint-markdownlint': fixMarkdownlint,
  'lint-staged-stylelint': fixStylelint,
  'lint-stylelint': fixStylelint,
  'format-staged-prettier': fixPrettier,
  'format-prettier': fixPrettier,
  'format-staged-ruff': fixRuffFormat,
  'format-ruff': fixRuffFormat,
  'format-staged-shfmt': fixShfmt,
  'format-shfmt': fixShfmt,
  'format-staged-taplo': fixTaplo,
  'format-taplo': fixTaplo,
  'lint-staged-sqlfluff': fixSqlfluff,
  'lint-sqlfluff': fixSqlfluff,
};

export function getFixRunnerForPath(path: string): ((ctx: AutoFixContext) => Promise<FixResult>) | undefined {
  if (!nodeSupportsAutoFix(path)) return undefined;
  const suffix = path.includes('.checks.') ? path.slice(path.lastIndexOf('.checks.') + '.checks.'.length) : path;
  return FIX_COMMANDS[suffix];
}

export function buildGateCheckPath(gatePathPrefix: string, checkId: string): string {
  // 防御双重 `.checks`：若调用方误传已含 `.checks` 的前缀，去掉尾段再拼接，避免 fail-open
  const normalizedPrefix = gatePathPrefix.endsWith('.checks')
    ? gatePathPrefix.slice(0, -'.checks'.length)
    : gatePathPrefix;
  return `${normalizedPrefix}.checks.${checkId}`;
}

export async function runAutoFixIfEnabled(path: string, ctx: AutoFixContext): Promise<{ ran: boolean } & FixResult> {
  if (!isGateNodeAutoFixEnabled(path, ctx.cwd)) {
    return { ran: false, success: true };
  }
  const runner = getFixRunnerForPath(path);
  if (!runner) {
    return { ran: false, success: true };
  }
  const result = await runner(ctx);
  return { ran: true, ...result };
}

export async function runWithAutoFixRetry(
  gatePath: string,
  ctx: AutoFixContext,
  runCheck: () => Promise<CheckResult>,
): Promise<CheckResult> {
  const first = await runCheck();
  if (first.decision !== DECISION.DENY) return first;
  if (!isGateNodeAutoFixEnabled(gatePath, ctx.cwd)) return first;

  const fix = await runAutoFixIfEnabled(gatePath, ctx);
  if (!fix.ran) return first;
  if (!fix.success) {
    return formatResult(first.checkId, DECISION.DENY, `autoFix 失败: ${fix.error ?? 'unknown'}`, first.details);
  }
  return runCheck();
}
