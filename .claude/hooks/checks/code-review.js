import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';

const DIFF_BLOCK_PATTERNS = [
  { id: 'debugger', regex: /^\+.*\bdebugger\b/, message: 'diff 中包含 debugger 语句' },
  { id: 'console-log', regex: /^\+.*console\.log\(/, message: 'diff 中包含 console.log（建议移除）' },
  { id: 'todo-fixme', regex: /^\+.*\b(TODO|FIXME|HACK|XXX)\b/i, message: 'diff 中包含 TODO/FIXME 标记' },
];

/** @param {string} [cwd] @param {{ base?: string; staged?: boolean }} [options] */
export async function runCodeReview(cwd, options = {}) {
  const staged = options.staged === true;
  const diffCmd = staged ? 'git diff --cached --unified=0' : `git diff ${options.base || 'HEAD~1'}..HEAD --unified=0`;
  const diffResult = execCommand(diffCmd, { cwd, timeout: 30000 });
  if (!diffResult.success || !diffResult.stdout.trim()) {
    return formatResult(
      staged ? 'code-review-staged' : 'code-review',
      DECISION.SKIP,
      staged ? '暂存区无 diff 可审查，跳过' : '无 diff 可审查，跳过',
    );
  }

  const addedLines = diffResult.stdout
    .split('\n')
    .filter((/** @type {string} */ l) => l.startsWith('+') && !l.startsWith('+++'));
  const findings = [];
  for (const line of addedLines) {
    for (const pattern of DIFF_BLOCK_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push(pattern.message);
        break;
      }
    }
  }

  const checkId = staged ? 'code-review-staged' : 'code-review';
  if (findings.length > 0) {
    return formatResult(checkId, DECISION.WARN, `静态 review 发现 ${findings.length} 项提醒`, {
      findings: findings.slice(0, 10),
    });
  }
  return formatResult(checkId, DECISION.ALLOW, '静态 diff review 通过');
}
