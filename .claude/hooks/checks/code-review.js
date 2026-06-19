import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';

const DIFF_BLOCK_PATTERNS = [
  { id: 'debugger', regex: /^\+.*\bdebugger\b/, message: 'diff 中包含 debugger 语句' },
  { id: 'console-log', regex: /^\+.*console\.log\(/, message: 'diff 中包含 console.log（建议移除）' },
  { id: 'todo-fixme', regex: /^\+.*\b(TODO|FIXME|HACK|XXX)\b/i, message: 'diff 中包含 TODO/FIXME 标记' },
];

/** @param {string} [cwd] @param {{ base?: string }} [options] */
export async function runCodeReview(cwd, options = {}) {
  const base = options.base || 'HEAD~1';
  const diffResult = execCommand(`git diff ${base}..HEAD --unified=0`, { cwd, timeout: 30000 });
  if (!diffResult.success || !diffResult.stdout.trim()) {
    return formatResult('code-review', DECISION.SKIP, '无 diff 可审查，跳过');
  }

  const addedLines = diffResult.stdout.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const findings = [];
  for (const line of addedLines) {
    for (const pattern of DIFF_BLOCK_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push(pattern.message);
        break;
      }
    }
  }

  if (findings.length > 0) {
    return formatResult('code-review', DECISION.WARN, `静态 review 发现 ${findings.length} 项提醒`, { findings: findings.slice(0, 10) });
  }
  return formatResult('code-review', DECISION.ALLOW, '静态 diff review 通过');
}
