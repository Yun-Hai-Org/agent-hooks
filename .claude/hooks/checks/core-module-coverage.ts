import { basename } from 'path';
import { resolveCoreModuleCoverageConfig } from '../gate-config.js';
import { formatResult, DECISION } from '../security-orchestrator.js';
import { isHooksProject } from './hooks-project.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

export interface PerFileCoverageMetrics {
  lines: number | null;
  functions: number | null;
}

export function parsePerFileCoverageFromBunOutput(output: string): Map<string, PerFileCoverageMetrics> {
  const metrics = new Map<string, PerFileCoverageMetrics>();
  const rowRe = /^\s*(.+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|/;

  for (const line of output.split('\n')) {
    const match = rowRe.exec(line);
    if (!match?.[1] || match[1].includes('All files') || match[1].includes('File')) continue;
    const filePath = match[1].trim().replace(/^\.\//, '');
    const functions = parseFloat(match[2] ?? '');
    const lines = parseFloat(match[3] ?? '');
    metrics.set(filePath, {
      functions: Number.isFinite(functions) ? functions : null,
      lines: Number.isFinite(lines) ? lines : null,
    });
    metrics.set(basename(filePath), {
      functions: Number.isFinite(functions) ? functions : null,
      lines: Number.isFinite(lines) ? lines : null,
    });
  }

  return metrics;
}

function resolveModuleMetrics(
  modulePath: string,
  metrics: Map<string, PerFileCoverageMetrics>,
): PerFileCoverageMetrics | undefined {
  const hooksPrefix = `.claude/hooks/${modulePath}`;
  return metrics.get(hooksPrefix) ?? metrics.get(modulePath) ?? metrics.get(basename(modulePath));
}

export function runCoreModuleCoverage(
  cwd?: string,
  coverageOutput?: string,
  options: GateCheckRunOptions = {},
): CheckResult {
  const root = cwd ?? process.cwd();
  if (!isHooksProject(root)) {
    return formatResult('core-module-coverage', DECISION.SKIP, '非 hooks 项目，跳过核心模块覆盖率');
  }

  const output = coverageOutput ?? options.coverageReport;
  if (!output?.trim()) {
    return formatResult('core-module-coverage', DECISION.SKIP, '无 coverage 报告，跳过核心模块覆盖率');
  }

  const config = resolveCoreModuleCoverageConfig(root);
  const perFile = parsePerFileCoverageFromBunOutput(output);
  const failures: string[] = [];

  for (const modulePath of config.paths) {
    const moduleMetrics = resolveModuleMetrics(modulePath, perFile);
    if (!moduleMetrics) {
      failures.push(`${modulePath} 未出现在 coverage 报告`);
      continue;
    }
    if (moduleMetrics.lines === null || moduleMetrics.lines < config.lines) {
      failures.push(`${modulePath} Lines ${String(moduleMetrics.lines ?? 'N/A')}% < ${String(config.lines)}%`);
    }
    if (moduleMetrics.functions === null || moduleMetrics.functions < config.functions) {
      failures.push(`${modulePath} Funcs ${String(moduleMetrics.functions ?? 'N/A')}% < ${String(config.functions)}%`);
    }
  }

  if (failures.length > 0) {
    return formatResult('core-module-coverage', DECISION.DENY, `核心模块覆盖率未达标：${failures.join('；')}`);
  }

  return formatResult(
    'core-module-coverage',
    DECISION.ALLOW,
    `核心模块覆盖率达标（${String(config.paths.length)} 个模块 ≥ ${String(config.lines)}%/${String(config.functions)}%）`,
  );
}
