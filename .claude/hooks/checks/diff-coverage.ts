import {
  resolveDiffCoverageThreshold,
  isDiffCoverageEnforcedFor,
  type ResolvedDiffCoverageThreshold,
} from '../gate-config.js';
import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing } from './tools.js';
import { isHooksProject } from './hooks-project.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

export interface ChangedLineEntry {
  file: string;
  line: number;
}

export interface FileCoverageHits {
  uncoveredLines: Set<number>;
  linesPercent: number | null;
}

export function matchGlobPattern(path: string, pattern: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const regexSource = pattern
    .replace(/\\/g, '/')
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regexSource}$`).test(normalized);
}

function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((p) => matchGlobPattern(path, p));
}

function isExecutableAddedLine(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return false;
  if (/^import\s+type\b/.test(trimmed)) return false;
  if (/^export\s+type\b/.test(trimmed)) return false;
  return true;
}

function resolveMergeBase(cwd: string, baseRef: 'auto' | string): string | null {
  if (baseRef !== 'auto') {
    const explicit = execCommand(`git merge-base HEAD "${baseRef}"`, { cwd, timeout: 10000 });
    return explicit.success && explicit.stdout.trim() ? explicit.stdout.trim() : null;
  }
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const result = execCommand(`git merge-base HEAD "${ref}"`, { cwd, timeout: 10000 });
    if (result.success && result.stdout.trim()) return result.stdout.trim();
  }
  const firstCommit = execCommand('git rev-list --max-parents=0 HEAD', { cwd, timeout: 10000 });
  return firstCommit.success && firstCommit.stdout.trim() ? (firstCommit.stdout.trim().split('\n')[0] ?? null) : null;
}

export function parsePushDiffExecutableLines(cwd: string, config: ResolvedDiffCoverageThreshold): ChangedLineEntry[] {
  const base = resolveMergeBase(cwd, config.baseRef);
  if (!base) return [];

  const diff = execCommand(`git diff -U0 "${base}...HEAD"`, { cwd, timeout: 60000 });
  if (!diff.success || !diff.stdout.trim()) return [];

  const entries: ChangedLineEntry[] = [];
  let currentFile = '';
  let newLine = 0;

  for (const rawLine of diff.stdout.split('\n')) {
    if (rawLine.startsWith('+++ b/')) {
      currentFile = rawLine.slice('+++ b/'.length).trim();
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(rawLine);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!currentFile || !rawLine.startsWith('+') || rawLine.startsWith('+++')) continue;
    const content = rawLine.slice(1);
    if (!isExecutableAddedLine(content)) continue;
    if (!matchesAnyGlob(currentFile, config.include)) continue;
    if (matchesAnyGlob(currentFile, config.exclude)) continue;
    entries.push({ file: currentFile, line: newLine });
    newLine += 1;
  }

  return entries;
}

export function parseCoverageLineHits(output: string): Map<string, FileCoverageHits> {
  const hits = new Map<string, FileCoverageHits>();
  const rowRe = /^\s*(.+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(.*)$/;

  for (const line of output.split('\n')) {
    const match = rowRe.exec(line);
    if (!match?.[1] || match[1].includes('All files') || match[1].includes('File')) continue;
    const filePath = match[1].trim().replace(/^\.\//, '');
    const linesPercent = parseFloat(match[3] ?? '');
    const uncoveredRaw = (match[4] ?? '').trim();
    const uncovered = new Set<number>();
    if (uncoveredRaw) {
      for (const part of uncoveredRaw.split(',')) {
        const trimmed = part.trim();
        const range = /^(\d+)-(\d+)$/.exec(trimmed);
        if (range) {
          const start = Number(range[1]);
          const end = Number(range[2]);
          for (let i = start; i <= end; i += 1) uncovered.add(i);
        } else if (/^\d+$/.test(trimmed)) {
          uncovered.add(Number(trimmed));
        }
      }
    }
    hits.set(filePath, {
      uncoveredLines: uncovered,
      linesPercent: Number.isFinite(linesPercent) ? linesPercent : null,
    });
  }

  return hits;
}

export function computeDiffCoveragePercent(
  changedLines: ChangedLineEntry[],
  coverageHits: Map<string, FileCoverageHits>,
): { percent: number | null; covered: number; total: number } {
  if (changedLines.length === 0) {
    return { percent: null, covered: 0, total: 0 };
  }

  let covered = 0;
  for (const entry of changedLines) {
    const fileHits = coverageHits.get(entry.file);
    if (!fileHits) continue;
    if (fileHits.linesPercent === 100) {
      covered += 1;
      continue;
    }
    if (fileHits.linesPercent === 0) continue;
    if (fileHits.uncoveredLines.size > 0) {
      if (!fileHits.uncoveredLines.has(entry.line)) covered += 1;
      continue;
    }
    if (fileHits.linesPercent !== null) {
      covered += fileHits.linesPercent / 100;
    }
  }

  const total = changedLines.length;
  return { percent: (covered / total) * 100, covered, total };
}

export function runDiffCoverage(cwd?: string, options: GateCheckRunOptions = {}): CheckResult {
  const root = cwd ?? process.cwd();
  if (!isHooksProject(root)) {
    return formatResult('diff-coverage', DECISION.SKIP, '非 hooks 项目，跳过 diff 覆盖率');
  }

  if (!isDiffCoverageEnforcedFor('push', root)) {
    return formatResult('diff-coverage', DECISION.SKIP, 'diffCoverageThreshold.enforceOn 未含 push，跳过');
  }

  const config = resolveDiffCoverageThreshold(root);
  const changedLines = parsePushDiffExecutableLines(root, config);
  if (changedLines.length === 0) {
    return formatResult('diff-coverage', DECISION.SKIP, 'merge-base 无匹配源码变更，跳过 diff 覆盖率');
  }

  let coverageOutput = options.coverageReport ?? '';
  if (!coverageOutput) {
    const missing = denyIfToolMissing('bun', 'diff-coverage', root);
    if (missing) return missing;
    const result = execCommand('bun test ./.claude/hooks/__tests__/*.test.ts --coverage --dots --concurrency=1 2>&1', {
      cwd: root,
      timeout: options.timeoutMs ?? 1_200_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    coverageOutput = result.stdout + result.stderr;
    if (!result.success) {
      return formatResult('diff-coverage', DECISION.DENY, '全量单测失败，无法计算 diff 覆盖率', {
        output: coverageOutput.slice(0, 500),
      });
    }
  }

  const hits = parseCoverageLineHits(coverageOutput);
  const { percent, covered, total } = computeDiffCoveragePercent(changedLines, hits);
  if (percent === null) {
    return formatResult('diff-coverage', DECISION.DENY, '无法计算 diff 覆盖率');
  }

  if (percent < config.lines) {
    return formatResult(
      'diff-coverage',
      DECISION.DENY,
      `Diff 覆盖率 ${percent.toFixed(1)}% < ${String(config.lines)}%（${String(covered)}/${String(total)} 变更行命中）`,
    );
  }

  return formatResult(
    'diff-coverage',
    DECISION.ALLOW,
    `Diff 覆盖率 ${percent.toFixed(1)}% 达标（${String(covered)}/${String(total)} 变更行，阈值 ${String(config.lines)}%）`,
  );
}
