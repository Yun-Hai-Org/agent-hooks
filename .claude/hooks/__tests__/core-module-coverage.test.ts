import { describe, it, expect } from 'bun:test';
import { parsePerFileCoverageFromBunOutput, runCoreModuleCoverage } from '../checks/core-module-coverage.js';
import { CORE_MODULE_PATHS } from '../gate-registry.js';
import { DECISION } from '../security-orchestrator.js';
import { PROJECT_ROOT } from './helpers.js';

const SAMPLE_OUTPUT = `
----------------------------------------|---------|---------|-------------------
File                                    | % Funcs | % Lines | Uncovered Line #s
----------------------------------------|---------|---------|-------------------
All files                               |   85.00 |   90.00 |
 .claude/hooks/quality-gate.ts          |   95.00 |   92.00 |
 .claude/hooks/gate-config.ts           |   91.00 |   93.00 |
 .claude/hooks/gate-registry.ts         |   90.00 |   91.00 |
 .claude/hooks/checks/git-policy.ts     |   92.00 |   94.00 |
 .claude/hooks/merge-gate.ts            |   90.00 |   90.00 |
 .claude/hooks/push-gate.ts             |   91.00 |   92.00 |
`;

describe('parsePerFileCoverageFromBunOutput', () => {
  it('解析 per-file lines/functions', () => {
    const metrics = parsePerFileCoverageFromBunOutput(SAMPLE_OUTPUT);
    const gateConfig = metrics.get('.claude/hooks/gate-config.ts');
    expect(gateConfig?.lines).toBe(93);
    expect(gateConfig?.functions).toBe(91);
  });

  it('basename 别名可解析', () => {
    const metrics = parsePerFileCoverageFromBunOutput(SAMPLE_OUTPUT);
    expect(metrics.get('gate-config.ts')?.lines).toBe(93);
  });
});

describe('runCoreModuleCoverage', () => {
  it('达标报告 ALLOW', () => {
    const r = runCoreModuleCoverage(PROJECT_ROOT, SAMPLE_OUTPUT);
    expect(r.checkId).toBe('core-module-coverage');
    expect(r.decision).toBe(DECISION.ALLOW);
  });

  it('未达标报告 DENY', () => {
    const lowOutput = SAMPLE_OUTPUT.replace('92.00 |   94.00', '50.00 |   50.00');
    const r = runCoreModuleCoverage(PROJECT_ROOT, lowOutput);
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('git-policy.ts');
  });

  it('无报告 SKIP', () => {
    const r = runCoreModuleCoverage(PROJECT_ROOT);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('CORE_MODULE_PATHS 覆盖 6 个模块', () => {
    expect(CORE_MODULE_PATHS.length).toBe(6);
  });
});
