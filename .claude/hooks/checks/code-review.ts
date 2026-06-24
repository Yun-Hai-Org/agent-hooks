import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';

interface DiffPattern {
  id: string;
  severity: typeof DECISION.DENY | typeof DECISION.WARN;
  regex: RegExp;
  message: string;
}

const DIFF_PATTERNS: DiffPattern[] = [
  // debugger 语句为硬阻断：匹配独立 debugger 语句行，避免误伤含 "debugger" 字样的标识符/字符串
  { id: 'debugger', severity: DECISION.DENY, regex: /^\+\s*debugger\s*;?\s*$/, message: 'diff 中包含 debugger 语句' },
  {
    id: 'console-log',
    severity: DECISION.WARN,
    regex: /^\+.*console\.log\(/,
    message: 'diff 中包含 console.log（建议移除）',
  },
  {
    id: 'todo-fixme',
    severity: DECISION.WARN,
    regex: /^\+.*\b(TODO|FIXME|HACK|XXX)\b/,
    message: 'diff 中包含 TODO/FIXME 标记',
  },
];

export function scanDiffForFindings(diff: string): { deny: string[]; warn: string[] } {
  const addedLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const deny: string[] = [];
  const warn: string[] = [];
  for (const line of addedLines) {
    for (const pattern of DIFF_PATTERNS) {
      if (pattern.regex.test(line)) {
        (pattern.severity === DECISION.DENY ? deny : warn).push(pattern.message);
        break;
      }
    }
  }
  return { deny, warn };
}

export function runCodeReview(cwd?: string, options: { base?: string; staged?: boolean } = {}) {
  const staged = options.staged === true;
  const checkId = staged ? 'code-review-staged' : 'code-review';
  const diffCmd = staged ? 'git diff --cached --unified=0' : `git diff ${options.base ?? 'HEAD~1'}..HEAD --unified=0`;
  const diffResult = execCommand(diffCmd, { cwd, timeout: 30000 });
  if (!diffResult.success || !diffResult.stdout.trim()) {
    return formatResult(checkId, DECISION.SKIP, staged ? '暂存区无 diff 可审查，跳过' : '无 diff 可审查，跳过');
  }

  const { deny, warn } = scanDiffForFindings(diffResult.stdout);

  if (deny.length > 0) {
    return formatResult(checkId, DECISION.DENY, `静态 review 发现 ${String(deny.length)} 项阻断问题`, {
      findings: deny.slice(0, 10),
    });
  }
  if (warn.length > 0) {
    return formatResult(checkId, DECISION.WARN, `静态 review 发现 ${String(warn.length)} 项提醒`, {
      findings: warn.slice(0, 10),
    });
  }
  return formatResult(checkId, DECISION.ALLOW, '静态 diff review 通过');
}
