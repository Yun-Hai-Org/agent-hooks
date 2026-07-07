import { describe, it, expect } from 'bun:test';
import {
  buildGateDenyReason,
  buildGateRetryStopMessage,
  buildGateRetryPassMessage,
  buildGateRetryMergeSuccessMessage,
  buildGateRetryMergeFailureMessage,
} from '../gate-fix.js';
import { DECISION } from '../security-orchestrator.js';

const sampleGateResult = {
  results: [
    { checkId: 'eslint', decision: DECISION.DENY, message: 'lint failed' },
    { checkId: 'typecheck', decision: DECISION.ALLOW, message: 'ok' },
  ],
  decision: { reason: 'fallback reason' },
};

describe('gate-fix messages', () => {
  it('buildGateDenyReason 应包含 gate 名、命令与摘要', () => {
    const msg = buildGateDenyReason('pre-push', 'git push', sampleGateResult);
    expect(msg).toContain('pre-push');
    expect(msg).toContain('git push');
    expect(msg).toContain('eslint');
    expect(msg).toContain('修复上述');
  });

  it('buildGateDenyReason 无 results 时使用 decision.reason', () => {
    const msg = buildGateDenyReason('pre-commit', 'git commit', { decision: { reason: 'custom deny' } });
    expect(msg).toContain('custom deny');
  });

  it('buildGateDenyReason loopCount 应显示重试提示', () => {
    const msg = buildGateDenyReason('pre-push', 'git push', sampleGateResult, { loopCount: 2 });
    expect(msg).toContain('第 3 次修复重试');
  });

  it('buildGateRetryStopMessage merge 类型应含自动 merge 提示', () => {
    const msg = buildGateRetryStopMessage('pre-merge-commit', 'git merge feat/x', sampleGateResult, {
      pendingType: 'merge',
      loopCount: 1,
    });
    expect(msg).toContain('GATE_AUTO_RETRY_MERGE');
    expect(msg).toContain('第 2 次自动重试');
  });

  it('buildGateRetryStopMessage push 类型应提示手动 push', () => {
    const msg = buildGateRetryStopMessage('pre-push', 'git push', sampleGateResult, { pendingType: 'push' });
    expect(msg).toContain('手动重新执行 push');
  });

  it('buildGateRetryPassMessage merge 与 push 分支', () => {
    expect(buildGateRetryPassMessage('pre-merge-commit', 'git merge a', 'merge')).toContain('merge');
    expect(buildGateRetryPassMessage('pre-push', 'git push')).toContain('手动重新执行');
  });

  it('buildGateRetryMergeSuccessMessage 含 sha', () => {
    const msg = buildGateRetryMergeSuccessMessage('pre-merge-commit', 'git merge a', 'abc1234');
    expect(msg).toContain('abc1234');
    expect(msg).toContain('自动执行 merge');
  });

  it('buildGateRetryMergeFailureMessage 截断错误信息', () => {
    const msg = buildGateRetryMergeFailureMessage('git merge a', 'CONFLICT');
    expect(msg).toContain('merge 执行失败');
    expect(msg).toContain('CONFLICT');
  });
});
