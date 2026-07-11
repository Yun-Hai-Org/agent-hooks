import { execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import type { CheckResult, HadolintIssue, GateCheckRunOptions, GatePathPrefix } from '../types.js';
import { getStagedFiles } from './git-policy.js';
import {
  classifyFiles,
  hasStylelintConfig,
  isDockerComposePath,
  isDockerfilePath,
  listTrackedFiles,
} from './file-patterns.js';
import { denyIfToolMissing, denyOnToolError, getBunxInvocation } from './tools.js';
import { denyIfContainerRuntimeMissing, getComposeConfigCmd, resolveContainerRuntime } from './container-runtime.js';
import { buildGateCheckPath, runWithAutoFixRetry } from '../gate-autofix.js';
import { COMMIT_GATE_TIMEOUT_MS, FULL_GATE_TIMEOUT_MS } from '../gate-timeouts.js';

export const HADOLINT_SECURITY_RULES: Readonly<Record<string, string>> = Object.freeze({
  DL3006: 'HIGH',
  DL3023: 'HIGH',
  DL3025: 'HIGH',
  DL3002: 'HIGH',
  DL3003: 'HIGH',
  DL3007: 'HIGH',
  DL3008: 'HIGH',
  DL3009: 'HIGH',
  DL3018: 'HIGH',
  DL3019: 'HIGH',
  DL3020: 'HIGH',
  DL3022: 'HIGH',
  DL3024: 'HIGH',
  DL4006: 'HIGH',
  DL3010: 'MEDIUM',
  DL3011: 'MEDIUM',
  DL3012: 'MEDIUM',
  DL3013: 'MEDIUM',
  DL3015: 'MEDIUM',
  DL3016: 'MEDIUM',
  DL3021: 'MEDIUM',
  DL3028: 'MEDIUM',
  DL3038: 'MEDIUM',
  DL3039: 'MEDIUM',
  DL4001: 'MEDIUM',
  DL4003: 'MEDIUM',
  DL4005: 'MEDIUM',
});

export function getHadolintSeverity(hadolintSeverity: string, ruleId: string): string {
  if (hadolintSeverity === 'error') return 'CRITICAL';
  const ruleSeverity = HADOLINT_SECURITY_RULES[ruleId];
  if (ruleSeverity) return ruleSeverity;
  if (hadolintSeverity === 'warning') return 'HIGH';
  return 'MEDIUM';
}

/** @param {string} output */
export function parseHadolintOutput(output: string): HadolintIssue[] {
  const results: HadolintIssue[] = [];
  // eslint-disable-next-line no-control-regex
  const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = cleanOutput.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    const match = /^(.+?):(\d+)(?::\d+)?:?\s+(DL\d+)\s+(\w+):\s+(.+)$/.exec(line);
    if (match?.[1] && match[2] && match[3] && match[4] && match[5]) {
      const file = match[1];
      const lineNum = match[2];
      const ruleId = match[3];
      const hadolintSev = match[4];
      const message = match[5];
      results.push({
        file,
        line: parseInt(lineNum, 10),
        severity: getHadolintSeverity(hadolintSev, ruleId),
        ruleId,
        message: message.trim(),
      });
    }
  }

  return results;
}

function formatHadolintDenyOutput(output: string) {
  const issues = parseHadolintOutput(output);
  if (issues.length === 0) return output.slice(0, 500);
  const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
  issues.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));
  return issues
    .slice(0, 15)
    .map((i) => `[${i.severity}] ${i.ruleId}: ${i.file}:${String(i.line)} — ${i.message}`)
    .join('\n');
}

export interface LintIssue {
  file: string;
  line: number;
  column?: number;
  severity: string;
  ruleId: string;
  message: string;
}

const MARKDOWNLINT_BANNER_PREFIXES = ['markdownlint-cli2', 'Finding:', 'Linting:', 'Summary:'];

function stripMarkdownlintBanner(output: string): string {
  const lines = output.split('\n');
  const filtered = lines.filter((l) => {
    const trimmed = l.trim();
    if (!trimmed) return false;
    return !MARKDOWNLINT_BANNER_PREFIXES.some((p) => trimmed.startsWith(p));
  });
  return filtered.join('\n');
}

/**
 * 解析 markdownlint-cli2 v0.22.1 输出。
 * 真实样本: `mdtest.md:1:26 error MD009/no-trailing-spaces Trailing spaces [Expected: 0 or 2; Actual: 3]`
 * 注意: 第一个冒号后无空格；`error`/`warning` token 位于列号与规则之间；规则为 `MDxxx/规则名` 斜杠形式。
 */
export function parseMarkdownlintOutput(output: string): LintIssue[] {
  const results: LintIssue[] = [];
  // eslint-disable-next-line no-control-regex
  const cleanOutput = stripMarkdownlintBanner(output.replace(/\x1b\[[0-9;]*m/g, ''));
  const lines = cleanOutput.split('\n').filter((l) => l.trim());
  const re = /^(.+?):(\d+):(\d+)\s+(error|warning)\s+(MD\d+)\/[\w-]+\s+(.+)$/;
  for (const line of lines) {
    const match = re.exec(line);
    if (!match) continue;
    const [, file, lineNum, column, level, ruleId, message] = match;
    if (!file || !lineNum || !column || !level || !ruleId || !message) continue;
    // 渲染时剥离前导 `error `/`warning ` token，仅保留规则之后的消息文本
    results.push({
      file,
      line: parseInt(lineNum, 10),
      column: parseInt(column, 10),
      severity: level === 'error' ? 'ERROR' : 'WARN',
      ruleId,
      message: message.trim(),
    });
  }
  return results;
}

interface StylelintJsonItem {
  source?: string;
  warnings?: Array<{
    line: number;
    column: number;
    rule: string;
    text: string;
    severity?: string;
  }>;
  deprecations?: unknown[];
  invalidOptionWarnings?: unknown[];
}

/** 兼容 stylelint --formatter=json 输出或默认文本输出 */
export function parseStylelintOutput(output: string): LintIssue[] {
  const results: LintIssue[] = [];
  // eslint-disable-next-line no-control-regex
  const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  // JSON 路径
  if (cleanOutput.startsWith('[')) {
    try {
      const parsed = JSON.parse(cleanOutput) as StylelintJsonItem[];
      for (const item of parsed) {
        const file = item.source ?? '(unknown)';
        for (const w of item.warnings ?? []) {
          results.push({
            file,
            line: w.line,
            column: w.column,
            severity: (w.severity ?? 'error').toUpperCase() === 'WARNING' ? 'WARN' : 'ERROR',
            ruleId: w.rule || 'stylelint',
            message: w.text.replace(/\s*\([^)]*\)\s*$/, '').trim(),
          });
        }
      }
      return results;
    } catch {
      // fall through to text parser
    }
  }
  // 文本路径: `file.css:1:2  ✖  Unexpected message  rule-id` (compact-ish)
  const lines = cleanOutput.split('\n');
  const re = /^(.+?):(\d+):(\d+)\s+\S*[*✖×!]\s+(.+?)\s{2,}(\S+)$/;
  for (const line of lines) {
    const match = re.exec(line);
    if (!match) continue;
    const [, file, lineNum, column, message, ruleId] = match;
    if (!file || !lineNum || !column || !message || !ruleId) continue;
    results.push({
      file,
      line: parseInt(lineNum, 10),
      column: parseInt(column, 10),
      severity: 'ERROR',
      ruleId,
      message: message.trim(),
    });
  }
  return results;
}

/** 解析 shellcheck 输出: `script.sh:1:1: note: ... [SC2155]` */
export function parseShellcheckOutput(output: string): LintIssue[] {
  const results: LintIssue[] = [];
  // eslint-disable-next-line no-control-regex
  const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = cleanOutput.split('\n').filter((l) => l.trim());
  const re = /^(.+?):(\d+):(\d+):\s+(\w+):\s+(.+?)\s+\[(\w+)\]$/;
  for (const line of lines) {
    const match = re.exec(line);
    if (!match) continue;
    const [, file, lineNum, column, level, message, ruleId] = match;
    if (!file || !lineNum || !column || !level || !message || !ruleId) continue;
    results.push({
      file,
      line: parseInt(lineNum, 10),
      column: parseInt(column, 10),
      severity: level === 'error' ? 'ERROR' : level === 'warning' ? 'WARN' : level.toUpperCase(),
      ruleId,
      message: message.trim(),
    });
  }
  return results;
}

/** 解析 sqlfluff 输出: `L:   1 | P:   7 | LT01 | Expected only single space before naked identifier.` */
export function parseSqlfluffOutput(output: string): LintIssue[] {
  const results: LintIssue[] = [];
  // eslint-disable-next-line no-control-regex
  const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = cleanOutput.split('\n').filter((l) => l.trim());
  const re = /^L:\s*(\d+)\s*\|\s*P:\s*(\d+)\s*\|\s*(\w+)\s*\|\s+(.+)$/;
  for (const line of lines) {
    const match = re.exec(line);
    if (!match) continue;
    const [, lineNum, column, ruleId, message] = match;
    if (!lineNum || !column || !ruleId || !message) continue;
    results.push({
      file: '',
      line: parseInt(lineNum, 10),
      column: parseInt(column, 10),
      severity: 'ERROR',
      ruleId,
      message: message.trim(),
    });
  }
  return results;
}

/** taplo format --check 无结构化规则概念，仅标记格式问题 */
export function parseTaploOutput(output: string, defaultFile?: string): LintIssue[] {
  // eslint-disable-next-line no-control-regex
  const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = cleanOutput.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];
  // taplo 报头形如 `path/to/file.toml:`，每段对应一个文件
  const results: LintIssue[] = [];
  let currentFile = defaultFile ?? '';
  for (const line of lines) {
    const headerMatch = /^(.+?\.toml):\s*$/.exec(line);
    if (headerMatch?.[1]) {
      currentFile = headerMatch[1];
      continue;
    }
    // 错误行: `  N | content` 或 `> N | content` 形式
    const errLineMatch = /^[>\s]*\s*(\d+)\s*\|/.exec(line);
    if (errLineMatch?.[1]) {
      results.push({
        file: currentFile,
        line: parseInt(errLineMatch[1], 10),
        severity: 'ERROR',
        ruleId: 'TAPLO_FORMAT',
        message: 'taplo 格式检查未通过',
      });
      break; // 每个文件仅记一条
    }
  }
  return results;
}

const EXTENDED_LINT_TOOL_LABEL: Record<string, string> = {
  markdownlint: 'markdownlint',
  stylelint: 'stylelint',
  shellcheck: 'shellcheck',
  hadolint: 'hadolint',
  taplo: 'taplo',
  sqlfluff: 'sqlfluff',
  compose: 'compose',
};

const EXTENDED_LINT_PARSERS: Record<string, (output: string, file?: string) => LintIssue[]> = {
  markdownlint: parseMarkdownlintOutput,
  stylelint: parseStylelintOutput,
  shellcheck: parseShellcheckOutput,
  hadolint: (o: string) => parseHadolintOutput(o),
  taplo: (o: string, f?: string) => parseTaploOutput(o, f),
  sqlfluff: parseSqlfluffOutput,
};

/**
 * 统一渲染 extended-lint 报错为 `[工具] 规则: 文件:行 — 消息` 列表，最多 15 条。
 * 无可解析违规时回退到截断原始输出。
 */
export function formatExtendedLintDenyOutput(tool: string, output: string, file?: string): string {
  const label = EXTENDED_LINT_TOOL_LABEL[tool] ?? tool;
  const parser = EXTENDED_LINT_PARSERS[tool];
  if (!parser) return output.slice(0, 500);
  const issues = parser(output, file);
  if (issues.length === 0) return output.slice(0, 500);
  return issues
    .slice(0, 15)
    .map((i) => {
      const loc = i.file || file || '';
      const suffix = loc ? `:${loc}:${String(i.line)}` : `:line ${String(i.line)}`;
      return `[${label}][${i.severity}] ${i.ruleId}${suffix} — ${i.message}`;
    })
    .join('\n');
}

function aggregateExtendedResults(
  results: CheckResult[],
  skipId: string,
  allowId: string,
  skipMsg: string,
  allowMsg: string,
) {
  if (results.length === 0) {
    return formatResult(skipId, DECISION.SKIP, skipMsg);
  }
  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure ?? formatResult(allowId, DECISION.ALLOW, allowMsg);
}

async function runExtendedChecks(
  classified: ReturnType<typeof classifyFiles>,
  idPrefix: string,
  cwd: string,
  gatePathPrefix: GatePathPrefix,
  timeoutMs: number,
): Promise<CheckResult> {
  const results: CheckResult[] = [];
  const stagedPrefix = idPrefix === 'extended-staged' ? 'lint-staged' : 'lint';
  const formatPrefix = idPrefix === 'extended-staged' ? 'format-staged' : 'format';
  // F11: auto-fix 仅覆盖 commit/staged（git.pre-commit）；full profile（git.pre-push）暂不接 auto-fix
  const autoFixEnabled = gatePathPrefix === 'git.pre-commit';

  if (classified.md.length > 0) {
    const missing = denyIfToolMissing('bun', `${stagedPrefix}-markdownlint`, cwd);
    if (missing) return missing;
    const files = classified.md.map((f) => `"${f}"`).join(' ');
    const checkId = `${stagedPrefix}-markdownlint`;
    const gatePath = buildGateCheckPath(gatePathPrefix, checkId);
    const runMdCheck = async (): Promise<CheckResult> => {
      try {
        const mdResult = await withTimeout(
          execCommandAsync(`${getBunxInvocation(cwd)} markdownlint-cli2 ${files}`, { cwd, timeout: 120000 }),
          120000,
          'markdownlint 超时 (120s)',
        );
        const output = mdResult.stdout || mdResult.stderr;
        return mdResult.success
          ? formatResult(checkId, DECISION.ALLOW, 'markdownlint 检查通过')
          : formatResult(checkId, DECISION.DENY, 'markdownlint 检查失败', {
              output: formatExtendedLintDenyOutput('markdownlint', output),
            });
      } catch (e) {
        return denyOnToolError(e, checkId, 'markdownlint');
      }
    };
    if (autoFixEnabled) {
      results.push(await runWithAutoFixRetry(gatePath, { cwd, files: classified.md, timeoutMs }, runMdCheck));
    } else {
      results.push(await runMdCheck());
    }
  }

  if (classified.shell.length > 0) {
    const shfmtMissing = denyIfToolMissing('shfmt', `${formatPrefix}-shfmt`, cwd);
    if (shfmtMissing) return shfmtMissing;
    const shellMissing = denyIfToolMissing('shellcheck', `${stagedPrefix}-shellcheck`, cwd);
    if (shellMissing) return shellMissing;

    const files = classified.shell.map((f) => `"${f}"`).join(' ');
    try {
      const shfmtResult = await withTimeout(
        execCommandAsync(`shfmt -d ${files}`, { cwd, timeout: 30000 }),
        30000,
        'shfmt 超时 (30s)',
      );
      const shfmtOutput = shfmtResult.stderr || shfmtResult.stdout;
      results.push(
        shfmtResult.success
          ? formatResult(`${formatPrefix}-shfmt`, DECISION.ALLOW, 'shfmt 格式检查通过')
          : formatResult(`${formatPrefix}-shfmt`, DECISION.DENY, 'shfmt 格式检查失败', {
              output: shfmtOutput.slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, `${formatPrefix}-shfmt`, 'shfmt'));
    }

    try {
      const shellcheckResult = await withTimeout(
        execCommandAsync(`shellcheck ${files}`, { cwd, timeout: 60000 }),
        60000,
        'shellcheck 超时 (60s)',
      );
      const scOutput = shellcheckResult.stdout || shellcheckResult.stderr;
      results.push(
        shellcheckResult.success
          ? formatResult(`${stagedPrefix}-shellcheck`, DECISION.ALLOW, 'shellcheck 检查通过')
          : formatResult(`${stagedPrefix}-shellcheck`, DECISION.DENY, 'shellcheck 检查失败', {
              output: formatExtendedLintDenyOutput('shellcheck', scOutput),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, `${stagedPrefix}-shellcheck`, 'shellcheck'));
    }
  }

  if (classified.docker.length > 0) {
    const missing = denyIfToolMissing('hadolint', `${stagedPrefix}-hadolint`, cwd);
    if (missing) return missing;

    for (const file of classified.docker) {
      try {
        const hadolintResult = await withTimeout(
          execCommandAsync(`hadolint "${file}"`, { cwd, timeout: 30000 }),
          30000,
          `hadolint 超时 (30s): ${file}`,
        );
        const rawOutput = hadolintResult.stdout || hadolintResult.stderr;
        results.push(
          hadolintResult.success
            ? formatResult(`${stagedPrefix}-hadolint`, DECISION.ALLOW, `hadolint 检查通过: ${file}`)
            : formatResult(`${stagedPrefix}-hadolint`, DECISION.DENY, `hadolint 检查失败: ${file}`, {
                output: formatHadolintDenyOutput(rawOutput),
              }),
        );
      } catch (e) {
        results.push(denyOnToolError(e, `${stagedPrefix}-hadolint`, 'hadolint'));
      }
    }
  }

  if (classified.compose.length > 0) {
    const missing = denyIfContainerRuntimeMissing(`${stagedPrefix}-compose`, cwd);
    if (missing) return missing;

    const runtime = resolveContainerRuntime(cwd);
    if (!runtime) {
      return formatResult(`${stagedPrefix}-compose`, DECISION.DENY, '容器运行时未安装（需 podman 或 docker）');
    }

    for (const file of classified.compose) {
      const composeCmd = getComposeConfigCmd(file, cwd);
      if (!composeCmd) {
        results.push(
          formatResult(`${stagedPrefix}-compose`, DECISION.DENY, `无法构建 ${runtime.name} compose 命令: ${file}`),
        );
        continue;
      }
      try {
        const composeResult = await withTimeout(
          execCommandAsync(composeCmd, { cwd, timeout: 30000 }),
          30000,
          `${runtime.name} compose 超时 (30s): ${file}`,
        );
        const rawOutput = composeResult.stdout || composeResult.stderr;
        results.push(
          composeResult.success
            ? formatResult(`${stagedPrefix}-compose`, DECISION.ALLOW, `${runtime.name} compose 检查通过: ${file}`)
            : formatResult(`${stagedPrefix}-compose`, DECISION.DENY, `${runtime.name} compose 检查失败: ${file}`, {
                output: rawOutput.slice(0, 500),
              }),
        );
      } catch (e) {
        results.push(denyOnToolError(e, `${stagedPrefix}-compose`, `${runtime.name} compose`));
      }
    }
  }

  if (classified.toml.length > 0) {
    const missing = denyIfToolMissing('taplo', `${formatPrefix}-taplo`, cwd);
    if (missing) return missing;
    const checkId = `${formatPrefix}-taplo`;
    const gatePath = buildGateCheckPath(gatePathPrefix, checkId);
    const runTaploCheck = async (): Promise<CheckResult> => {
      try {
        const files = classified.toml.map((f) => `"${f}"`).join(' ');
        const taploResult = await withTimeout(
          execCommandAsync(`taplo format --check ${files}`, { cwd, timeout: 30000 }),
          30000,
          'taplo 超时 (30s)',
        );
        const output = taploResult.stderr || taploResult.stdout;
        return taploResult.success
          ? formatResult(checkId, DECISION.ALLOW, 'taplo 格式检查通过')
          : formatResult(checkId, DECISION.DENY, 'taplo 格式检查失败', {
              output: formatExtendedLintDenyOutput('taplo', output),
            });
      } catch (e) {
        return denyOnToolError(e, checkId, 'taplo');
      }
    };
    if (autoFixEnabled) {
      results.push(await runWithAutoFixRetry(gatePath, { cwd, files: classified.toml, timeoutMs }, runTaploCheck));
    } else {
      results.push(await runTaploCheck());
    }
  }

  if (classified.sql.length > 0) {
    const missing = denyIfToolMissing('sqlfluff', `${stagedPrefix}-sqlfluff`, cwd);
    if (missing) return missing;
    const checkId = `${stagedPrefix}-sqlfluff`;
    const gatePath = buildGateCheckPath(gatePathPrefix, checkId);

    const runSqlfluffForFile = async (file: string): Promise<CheckResult> => {
      try {
        const sqlResult = await withTimeout(
          execCommandAsync(`sqlfluff lint "${file}" --dialect ansi`, { cwd, timeout: 60000 }),
          60000,
          `sqlfluff 超时 (60s): ${file}`,
        );
        const output = sqlResult.stdout || sqlResult.stderr;
        return sqlResult.success
          ? formatResult(checkId, DECISION.ALLOW, `sqlfluff 检查通过: ${file}`)
          : formatResult(checkId, DECISION.DENY, `sqlfluff 检查失败: ${file}`, {
              output: formatExtendedLintDenyOutput('sqlfluff', output, file),
            });
      } catch (e) {
        return denyOnToolError(e, checkId, 'sqlfluff');
      }
    };

    if (autoFixEnabled) {
      for (const file of classified.sql) {
        results.push(
          await runWithAutoFixRetry(gatePath, { cwd, files: [file], timeoutMs }, () => runSqlfluffForFile(file)),
        );
      }
    } else {
      for (const file of classified.sql) {
        results.push(await runSqlfluffForFile(file));
      }
    }
  }

  if (classified.css.length > 0 && hasStylelintConfig(cwd)) {
    const missing = denyIfToolMissing('bun', `${stagedPrefix}-stylelint`, cwd);
    if (missing) return missing;
    const checkId = `${stagedPrefix}-stylelint`;
    const gatePath = buildGateCheckPath(gatePathPrefix, checkId);
    const runStylelintCheck = async (): Promise<CheckResult> => {
      try {
        const files = classified.css.map((f) => `"${f}"`).join(' ');
        const stylelintResult = await withTimeout(
          execCommandAsync(`${getBunxInvocation(cwd)} stylelint ${files}`, { cwd, timeout: 60000 }),
          60000,
          'stylelint 超时 (60s)',
        );
        const output = stylelintResult.stderr || stylelintResult.stdout;
        if (
          !stylelintResult.success &&
          (output.includes('No configuration provided') || output.includes('ConfigurationError'))
        ) {
          return formatResult(checkId, DECISION.SKIP, '未找到 stylelint 配置文件，跳过');
        }
        return stylelintResult.success
          ? formatResult(checkId, DECISION.ALLOW, 'stylelint 检查通过')
          : formatResult(checkId, DECISION.DENY, 'stylelint 检查失败', {
              output: formatExtendedLintDenyOutput('stylelint', output),
            });
      } catch (e) {
        return denyOnToolError(e, checkId, 'stylelint');
      }
    };
    if (autoFixEnabled) {
      results.push(await runWithAutoFixRetry(gatePath, { cwd, files: classified.css, timeoutMs }, runStylelintCheck));
    } else {
      results.push(await runStylelintCheck());
    }
  }

  return aggregateExtendedResults(
    results,
    `${idPrefix}-extended`,
    `${idPrefix}-extended`,
    '无扩展 lint 目标文件，跳过',
    '扩展 lint 检查通过',
  );
}

export async function runExtendedLintStaged(cwd?: string, options?: GateCheckRunOptions) {
  const root = cwd ?? process.cwd();
  const gatePathPrefix: GatePathPrefix = options?.gatePathPrefix ?? 'git.pre-commit';
  const timeoutMs = options?.timeoutMs ?? COMMIT_GATE_TIMEOUT_MS;
  const staged = getStagedFiles(cwd);
  const classified = classifyFiles(staged, cwd);
  const hasTargets =
    classified.md.length +
      classified.shell.length +
      classified.docker.length +
      classified.compose.length +
      classified.toml.length +
      classified.sql.length +
      classified.css.length >
    0;

  if (!hasTargets) {
    return formatResult('extended-staged', DECISION.SKIP, '暂存区无扩展 lint 目标文件，跳过');
  }

  return runExtendedChecks(classified, 'extended-staged', root, gatePathPrefix, timeoutMs);
}

export async function runExtendedLintFull(cwd?: string, options?: GateCheckRunOptions) {
  const root = cwd ?? process.cwd();
  const gatePathPrefix: GatePathPrefix = options?.gatePathPrefix ?? 'git.pre-push';
  const timeoutMs = options?.timeoutMs ?? FULL_GATE_TIMEOUT_MS;
  const classified = classifyFiles(
    listTrackedFiles((f) => {
      if (f.startsWith('_bmad-output/') || f.startsWith('_bmad/') || f.startsWith('GitHub/')) return false;
      if (f.startsWith('.claude/commands/') || f.startsWith('.cursor/commands/')) return false;
      if (f.startsWith('.claude/includes/') || f === '.claude/ralph-loop.local.md') return false;
      if (/^(hooks\.md|instrct\.md|CLAUDE\.md|agents-view\.md)$/.test(f)) return false;
      if (/^(安全配置分析报告|文档质量分析报告)\.md$/.test(f)) return false;
      if (/\.(md|mdx|sh|bash|zsh|toml|sql|css|scss|less)$/i.test(f)) return true;
      if (isDockerComposePath(f)) return true;
      return isDockerfilePath(f);
    }, cwd),
    cwd,
  );

  const hasTargets =
    classified.md.length +
      classified.shell.length +
      classified.docker.length +
      classified.compose.length +
      classified.toml.length +
      classified.sql.length +
      classified.css.length >
    0;

  if (!hasTargets) {
    return formatResult('extended-full', DECISION.SKIP, '仓库无扩展 lint 目标文件，跳过');
  }

  return runExtendedChecks(classified, 'extended-full', root, gatePathPrefix, timeoutMs);
}
