import { describe, it, expect } from 'bun:test';
import { summarizeResults } from '../quality-gate.js';
import { formatResult, DECISION } from '../security-orchestrator.js';

describe('commit-gate feedback', () => {
  it('summarizeResults 包含 details 输出', () => {
    const results = [
      formatResult('lint-staged-eslint', DECISION.DENY, 'ESLint 暂存文件检查失败', {
        output: 'error: Unexpected console statement',
      }),
    ];
    const summary = summarizeResults(results);
    expect(summary).toContain('lint-staged-eslint');
    expect(summary).toContain('Unexpected console statement');
  });
});
