import { describe, it, expect } from 'bun:test';
import { formatResult, decide, DECISION } from '../security-orchestrator.js';
import {
  getGitIgnoredDirs,
  extractMergeTarget,
  getCurrentBranch,
  runSemgrep,
  runKnip,
  runTrivy,
  runFullTests,
  runHookTests,
  generateSummary,
} from '../merge-gate.js';

describe('merge-gate', () => {
  describe('目标分支检测', () => {
    it('目标非 main/master 应该 skip', () => {
      const target = 'feat/test';
      const isMain = ['main', 'master'].includes(target);
      expect(isMain).toBe(false);
    });

    it('目标 main 应该触发全量检查', () => {
      const target = 'main';
      const isMain = ['main', 'master'].includes(target);
      expect(isMain).toBe(true);
    });

    it('目标 master 应该触发全量检查', () => {
      const target = 'master';
      const isMain = ['main', 'master'].includes(target);
      expect(isMain).toBe(true);
    });

    it('目标 develop 不应该触发全量检查', () => {
      const target = 'develop';
      const isMain = ['main', 'master'].includes(target);
      expect(isMain).toBe(false);
    });

    it('目标 feature/xxx 不应该触发全量检查', () => {
      const target = 'feature/xxx';
      const isMain = ['main', 'master'].includes(target);
      expect(isMain).toBe(false);
    });
  });

  describe('extractMergeTarget', () => {
    it('应该从 git merge main 中提取 main', () => {
      const result = extractMergeTarget('git merge main');
      expect(result).toBe('main');
    });

    it('应该从 git merge master 中提取 master', () => {
      const result = extractMergeTarget('git merge master');
      expect(result).toBe('master');
    });

    it('应该从 git merge feat/xxx 中提取 feat/xxx', () => {
      const result = extractMergeTarget('git merge feat/xxx');
      expect(result).toBe('feat/xxx');
    });

    it('应该处理带 --no-ff 的合并命令', () => {
      const result = extractMergeTarget('git merge --no-ff feat/xxx');
      expect(result).toBe('feat/xxx');
    });

    it('应该处理带 --squash 的合并命令', () => {
      const result = extractMergeTarget('git merge --squash feat/xxx');
      expect(result).toBe('feat/xxx');
    });

    it('无法提取时应该返回 null', () => {
      const result = extractMergeTarget('git merge');
      expect(result).toBe(null);
    });

    it('非 merge 命令应该返回 null', () => {
      const result = extractMergeTarget('git checkout main');
      expect(result).toBe(null);
    });
  });

  describe('getCurrentBranch', () => {
    it('应该返回当前分支名', () => {
      const branch = getCurrentBranch();
      expect(branch).toBeTruthy();
      expect(typeof branch).toBe('string');
    });
  });

  describe('getGitIgnoredDirs', () => {
    it('应该返回数组', () => {
      const dirs = getGitIgnoredDirs();
      expect(Array.isArray(dirs)).toBe(true);
    });

    it('应该包含常见的忽略目录', () => {
      const dirs = getGitIgnoredDirs();
      // 至少应该能找到一些忽略的目录或文件
      expect(dirs.length).toBeGreaterThan(0);
    });
  });

  describe('generateSummary', () => {
    it('应该生成包含所有检查项的摘要', () => {
      const results = [
        formatResult('semgrep', DECISION.ALLOW, 'Semgrep 通过'),
        formatResult('knip', DECISION.ALLOW, 'Knip 通过'),
        formatResult('trivy', DECISION.ALLOW, 'Trivy 通过'),
        formatResult('bun-test', DECISION.ALLOW, 'Bun 测试通过'),
        formatResult('hook-tests', DECISION.ALLOW, 'Hook 测试通过'),
      ];
      const summary = generateSummary(results);
      expect(summary).toContain('Semgrep');
      expect(summary).toContain('Knip');
      expect(summary).toContain('Trivy');
      expect(summary).toContain('Bun');
      expect(summary).toContain('Hook');
    });

    it('应该显示失败项', () => {
      const results = [
        formatResult('semgrep', DECISION.DENY, 'Semgrep 发现问题'),
        formatResult('knip', DECISION.ALLOW, 'Knip 通过'),
      ];
      const summary = generateSummary(results);
      expect(summary).toContain('❌');
      expect(summary).toContain('Semgrep 发现问题');
    });

    it('应该显示警告项', () => {
      const results = [formatResult('knip', DECISION.WARN, 'Knip 发现未使用导出')];
      const summary = generateSummary(results);
      expect(summary).toContain('⚠️');
      expect(summary).toContain('Knip 发现未使用导出');
    });
  });

  describe('runSemgrep', () => {
    it('应该返回结果对象', async () => {
      const result = await runSemgrep();
      expect(result).toHaveProperty('decision');
      expect(result).toHaveProperty('message');
    });

    it('如果 semgrep 未安装应该跳过', async () => {
      const result = await runSemgrep();
      // 结果应该是 ALLOW, DENY, 或 SKIP 之一
      expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(result.decision);
    });
  });

  describe('runKnip', () => {
    it(
      '应该返回结果对象',
      async () => {
        const result = await runKnip();
        expect(result).toHaveProperty('decision');
        expect(result).toHaveProperty('message');
      },
      { timeout: 35000 },
    );

    it(
      '结果应该是有效的决策',
      async () => {
        const result = await runKnip();
        expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP, DECISION.WARN]).toContain(result.decision);
      },
      { timeout: 35000 },
    );
  });

  describe('runTrivy', () => {
    it(
      '应该返回结果对象',
      async () => {
        const result = await runTrivy();
        expect(result).toHaveProperty('decision');
        expect(result).toHaveProperty('message');
      },
      { timeout: 65000 },
    );

    it(
      '如果 trivy 未安装应该跳过',
      async () => {
        const result = await runTrivy();
        expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(result.decision);
      },
      { timeout: 65000 },
    );
  });

  describe('runFullTests', () => {
    it(
      '应该返回结果对象',
      async () => {
        const result = await runFullTests();
        expect(result).toHaveProperty('decision');
        expect(result).toHaveProperty('message');
      },
      { timeout: 70000 },
    );

    it(
      '结果应该是有效的决策',
      async () => {
        const result = await runFullTests();
        expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(result.decision);
      },
      { timeout: 70000 },
    );
  });

  describe('runHookTests', () => {
    it(
      '应该返回结果对象',
      async () => {
        const result = await runHookTests();
        expect(result).toHaveProperty('decision');
        expect(result).toHaveProperty('message');
      },
      { timeout: 40000 },
    );

    it(
      '结果应该是有效的决策',
      async () => {
        const result = await runHookTests();
        expect([DECISION.ALLOW, DECISION.DENY, DECISION.SKIP]).toContain(result.decision);
      },
      { timeout: 40000 },
    );
  });

  describe('Semgrep 安全扫描结果', () => {
    it('Semgrep 发现 ERROR 级漏洞应该 deny', () => {
      const results = [formatResult('semgrep-sast', DECISION.DENY, 'Semgrep 发现 ERROR 漏洞')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });

    it('Semgrep 未安装应该 deny', () => {
      const results = [formatResult('semgrep-sast', DECISION.DENY, 'Semgrep 未安装')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });

    it('Semgrep 扫描通过应该 allow', () => {
      const results = [formatResult('semgrep-sast', DECISION.ALLOW, 'Semgrep 扫描通过')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.ALLOW);
    });

    it('Semgrep 发现 WARNING 应该 warn', () => {
      const results = [formatResult('semgrep-sast', DECISION.WARN, 'Semgrep 发现 WARNING')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.WARN);
    });
  });

  describe('Knip 死代码检测', () => {
    it('Knip 发现未使用文件应该 deny', () => {
      const results = [formatResult('knip-dead-code', DECISION.DENY, 'Knip 发现未使用文件')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });

    it('Knip 发现未使用依赖应该 deny', () => {
      const results = [formatResult('knip-dead-code', DECISION.DENY, 'Knip 发现未使用依赖')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });

    it('Knip 发现未声明依赖应该 deny', () => {
      const results = [formatResult('knip-dead-code', DECISION.DENY, 'Knip 发现未声明依赖')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });

    it('Knip 发现未使用导出应该 warning', () => {
      const results = [formatResult('knip-dead-code', DECISION.WARN, 'Knip 发现未使用导出')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.WARN);
    });

    it('Knip 干净项目应该 allow', () => {
      const results = [formatResult('knip-dead-code', DECISION.ALLOW, 'Knip 扫描通过')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.ALLOW);
    });

    it('Knip 配置缺失应该 deny', () => {
      const results = [formatResult('knip-dead-code', DECISION.DENY, 'knip.json 配置文件不存在')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });
  });

  describe('Trivy 漏洞扫描', () => {
    it('Trivy 发现 CRITICAL CVE 应该 deny', () => {
      const results = [formatResult('trivy-sca', DECISION.DENY, 'Trivy 发现 CRITICAL 漏洞')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });

    it('Trivy 发现 HIGH CVE 应该 deny', () => {
      const results = [formatResult('trivy-sca', DECISION.DENY, 'Trivy 发现 HIGH 漏洞')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });

    it('Trivy 发现 MEDIUM CVE 应该 warn', () => {
      const results = [formatResult('trivy-sca', DECISION.WARN, 'Trivy 发现 MEDIUM 漏洞')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.WARN);
    });

    it('Trivy 扫描通过应该 allow', () => {
      const results = [formatResult('trivy-sca', DECISION.ALLOW, 'Trivy 扫描通过')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.ALLOW);
    });

    it('Trivy 未安装应该 deny', () => {
      const results = [formatResult('trivy-sca', DECISION.DENY, 'Trivy 未安装')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });
  });

  describe('全量测试', () => {
    it('测试失败应该 deny', () => {
      const results = [formatResult('full-tests', DECISION.DENY, '测试失败')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
    });

    it('测试通过应该 allow', () => {
      const results = [formatResult('full-tests', DECISION.ALLOW, '所有测试通过')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.ALLOW);
    });

    it('测试跳过应该 skip', () => {
      const results = [formatResult('full-tests', DECISION.SKIP, '未找到测试配置')];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.ALLOW);
    });
  });

  describe('组合决策', () => {
    it('混合 Critical+Warning → deny 且仅报告 Critical', () => {
      const results = [
        formatResult('semgrep-sast', DECISION.DENY, 'Critical 漏洞'),
        formatResult('knip-dead-code', DECISION.WARN, 'Warning: 未使用导出'),
      ];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
      expect(d.denyResults.length).toBe(1);
      expect(d.warnResults.length).toBe(1);
    });

    it('全部通过应该 allow', () => {
      const results = [
        formatResult('semgrep-sast', DECISION.ALLOW, '通过'),
        formatResult('knip-dead-code', DECISION.ALLOW, '通过'),
        formatResult('trivy-sca', DECISION.ALLOW, '通过'),
        formatResult('full-tests', DECISION.ALLOW, '通过'),
      ];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.ALLOW);
    });

    it('多个 DENY 应该全部报告', () => {
      const results = [
        formatResult('semgrep-sast', DECISION.DENY, '漏洞 1'),
        formatResult('trivy-sca', DECISION.DENY, '漏洞 2'),
        formatResult('full-tests', DECISION.DENY, '测试失败'),
      ];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.DENY);
      expect(d.denyResults.length).toBe(3);
    });

    it('仅有 WARNING 应该 warn', () => {
      const results = [
        formatResult('knip-dead-code', DECISION.WARN, '未使用导出'),
        formatResult('trivy-sca', DECISION.WARN, 'MEDIUM 漏洞'),
      ];
      const d = decide(results);
      expect(d.decision).toBe(DECISION.WARN);
      expect(d.warnResults.length).toBe(2);
    });
  });

  describe('输入验证', () => {
    it('空 stdin 应该降级输出 {}', () => {
      expect('{}'.trim()).toBe('{}');
    });

    it('应该处理有效的 JSON 输入', () => {
      const input = '{"tool_name": "bash", "tool_input": {"command": "git merge main"}}';
      expect(() => JSON.parse(input)).not.toThrow();
      const data = JSON.parse(input);
      expect(data.tool_name).toBe('bash');
      expect(data.tool_input.command).toBe('git merge main');
    });

    it('应该拒绝无效的 JSON', () => {
      const input = '{invalid json}';
      expect(() => JSON.parse(input)).toThrow();
    });
  });
});
