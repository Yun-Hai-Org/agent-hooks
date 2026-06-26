import { execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import type { CheckResult, HadolintIssue } from '../types.js';
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

async function runExtendedChecks(classified: ReturnType<typeof classifyFiles>, idPrefix: string, cwd?: string) {
  const results: CheckResult[] = [];
  const stagedPrefix = idPrefix === 'extended-staged' ? 'lint-staged' : 'lint';
  const formatPrefix = idPrefix === 'extended-staged' ? 'format-staged' : 'format';

  if (classified.md.length > 0) {
    const missing = denyIfToolMissing('bun', `${stagedPrefix}-markdownlint`, cwd);
    if (missing) return missing;
    const files = classified.md.map((f) => `"${f}"`).join(' ');
    try {
      const mdResult = await withTimeout(
        execCommandAsync(`${getBunxInvocation(cwd)} markdownlint-cli2 ${files}`, { cwd, timeout: 120000 }),
        120000,
        'markdownlint 超时 (120s)',
      );
      results.push(
        mdResult.success
          ? formatResult(`${stagedPrefix}-markdownlint`, DECISION.ALLOW, 'markdownlint 检查通过')
          : formatResult(`${stagedPrefix}-markdownlint`, DECISION.DENY, 'markdownlint 检查失败', {
              output: (mdResult.stderr || mdResult.stdout).slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, `${stagedPrefix}-markdownlint`, 'markdownlint'));
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
      results.push(
        shfmtResult.success
          ? formatResult(`${formatPrefix}-shfmt`, DECISION.ALLOW, 'shfmt 格式检查通过')
          : formatResult(`${formatPrefix}-shfmt`, DECISION.DENY, 'shfmt 格式检查失败', {
              output: (shfmtResult.stderr || shfmtResult.stdout).slice(0, 500),
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
      results.push(
        shellcheckResult.success
          ? formatResult(`${stagedPrefix}-shellcheck`, DECISION.ALLOW, 'shellcheck 检查通过')
          : formatResult(`${stagedPrefix}-shellcheck`, DECISION.DENY, 'shellcheck 检查失败', {
              output: (shellcheckResult.stderr || shellcheckResult.stdout).slice(0, 500),
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
    const files = classified.toml.map((f) => `"${f}"`).join(' ');
    try {
      const taploResult = await withTimeout(
        execCommandAsync(`taplo format --check ${files}`, { cwd, timeout: 30000 }),
        30000,
        'taplo 超时 (30s)',
      );
      results.push(
        taploResult.success
          ? formatResult(`${formatPrefix}-taplo`, DECISION.ALLOW, 'taplo 格式检查通过')
          : formatResult(`${formatPrefix}-taplo`, DECISION.DENY, 'taplo 格式检查失败', {
              output: (taploResult.stderr || taploResult.stdout).slice(0, 500),
            }),
      );
    } catch (e) {
      results.push(denyOnToolError(e, `${formatPrefix}-taplo`, 'taplo'));
    }
  }

  if (classified.sql.length > 0) {
    const missing = denyIfToolMissing('sqlfluff', `${stagedPrefix}-sqlfluff`, cwd);
    if (missing) return missing;

    for (const file of classified.sql) {
      try {
        const sqlResult = await withTimeout(
          execCommandAsync(`sqlfluff lint "${file}" --dialect ansi`, { cwd, timeout: 60000 }),
          60000,
          `sqlfluff 超时 (60s): ${file}`,
        );
        results.push(
          sqlResult.success
            ? formatResult(`${stagedPrefix}-sqlfluff`, DECISION.ALLOW, `sqlfluff 检查通过: ${file}`)
            : formatResult(`${stagedPrefix}-sqlfluff`, DECISION.DENY, `sqlfluff 检查失败: ${file}`, {
                output: (sqlResult.stderr || sqlResult.stdout).slice(0, 500),
              }),
        );
      } catch (e) {
        results.push(denyOnToolError(e, `${stagedPrefix}-sqlfluff`, 'sqlfluff'));
      }
    }
  }

  if (classified.css.length > 0 && hasStylelintConfig(cwd)) {
    const missing = denyIfToolMissing('bun', `${stagedPrefix}-stylelint`, cwd);
    if (missing) return missing;
    const files = classified.css.map((f) => `"${f}"`).join(' ');
    try {
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
        results.push(formatResult(`${stagedPrefix}-stylelint`, DECISION.SKIP, '未找到 stylelint 配置文件，跳过'));
      } else {
        results.push(
          stylelintResult.success
            ? formatResult(`${stagedPrefix}-stylelint`, DECISION.ALLOW, 'stylelint 检查通过')
            : formatResult(`${stagedPrefix}-stylelint`, DECISION.DENY, 'stylelint 检查失败', {
                output: output.slice(0, 500),
              }),
        );
      }
    } catch (e) {
      results.push(denyOnToolError(e, `${stagedPrefix}-stylelint`, 'stylelint'));
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

export async function runExtendedLintStaged(cwd?: string) {
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

  return runExtendedChecks(classified, 'extended-staged', cwd);
}

export async function runExtendedLintFull(cwd?: string) {
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

  return runExtendedChecks(classified, 'extended-full', cwd);
}
