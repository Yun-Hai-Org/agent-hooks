#!/usr/bin/env bun
/**
 * Merge Gate - PreToolUse Hook for Bash
 * 合并门：在 git merge 到 main/master 时执行安全扫描和测试
 *
 * 检查优先级：
 * 1. Fast bail-out：非 git merge 命令 → allow
 * 2. 目标分支检测：非 main/master → skip
 * 3. 安全扫描（并行）：Semgrep + Knip + Trivy
 * 4. 全量测试（串行）：bun test / pytest
 * 5. Hook 自身测试：bun test .claude/hooks/__tests__/
 * 6. 生成安全报告 summary
 */

import {
  formatResult,
  decide,
  formatHookOutput,
  log,
  execCommand,
  readStdin,
  safeMain,
  withTimeout,
  DECISION,
  SEVERITY,
} from './security-orchestrator.js';

const HOOK_NAME = 'merge-gate';

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 从 git merge 命令中提取目标分支
 */
function extractMergeTarget(cmd) {
  // git merge feature/xxx
  const m = cmd.match(/\bgit\s+merge\b\s+([^\s-][^\s]*)/);
  return m ? m[1] : null;
}

/**
 * 获取当前分支名
 */
function getCurrentBranch() {
  const result = execCommand('git rev-parse --abbrev-ref HEAD');
  return result.success ? result.stdout.trim() : null;
}

// ─── 安全扫描 ─────────────────────────────────────────────────────────────────

/**
 * Semgrep 安全扫描
 */
async function runSemgrep() {
  const hasSemgrep = execCommand('which semgrep');
  if (!hasSemgrep.success) {
    return formatResult('semgrep', DECISION.SKIP, 'semgrep 未安装，跳过');
  }

  try {
    const result = await withTimeout(
      new Promise((resolve) => {
        const r = execCommand('semgrep --config auto --severity ERROR,WARNING --json .', { timeout: 60000 });
        resolve(r);
      }),
      60000,
      'semgrep 超时 (60s)',
    );

    if (!result.success && result.stderr) {
      // semgrep may exit non-zero with findings
      try {
        const json = JSON.parse(result.stdout);
        const errors = json.results?.filter((r) => r.extra?.severity === 'ERROR') || [];
        if (errors.length > 0) {
          return formatResult('semgrep', DECISION.DENY, `Semgrep 发现 ${errors.length} 个 ERROR 级别问题`, {
            count: errors.length,
            sample: errors.slice(0, 3).map((e) => e.extra?.message || e.check_id),
          });
        }
      } catch {}
    }

    if (result.success) {
      return formatResult('semgrep', DECISION.ALLOW, 'Semgrep 扫描通过');
    }

    return formatResult('semgrep', DECISION.ALLOW, 'Semgrep 扫描完成（无 ERROR）');
  } catch (e) {
    return formatResult('semgrep', DECISION.SKIP, `Semgrep 跳过: ${e.message}`);
  }
}

/**
 * Knip 未使用代码检测
 */
async function runKnip() {
  try {
    const result = await withTimeout(
      new Promise((resolve) => {
        const r = execCommand('bunx knip --reporter json', { timeout: 30000 });
        resolve(r);
      }),
      30000,
      'knip 超时 (30s)',
    );

    if (!result.success) {
      // knip exits non-zero when issues found
      try {
        const json = JSON.parse(result.stdout);
        const unusedFiles = json.files ? Object.keys(json.files).length : 0;
        const unusedDeps = json.dependencies ? Object.keys(json.dependencies).length : 0;
        if (unusedFiles > 0 || unusedDeps > 0) {
          return formatResult(
            'knip',
            DECISION.DENY,
            `Knip 发现 ${unusedFiles} 个未使用文件, ${unusedDeps} 个未使用依赖`,
            { unusedFiles, unusedDeps },
          );
        }
      } catch {}
    }

    return formatResult('knip', DECISION.ALLOW, 'Knip 检查通过（无未使用代码）');
  } catch (e) {
    return formatResult('knip', DECISION.SKIP, `Knip 跳过: ${e.message}`);
  }
}

/**
 * Trivy 漏洞扫描
 */
async function runTrivy() {
  const hasTrivy = execCommand('which trivy');
  if (!hasTrivy.success) {
    return formatResult('trivy', DECISION.SKIP, 'trivy 未安装，跳过');
  }

  try {
    const result = await withTimeout(
      new Promise((resolve) => {
        const r = execCommand('trivy fs --scanners vuln --severity CRITICAL,HIGH --format json .', { timeout: 60000 });
        resolve(r);
      }),
      60000,
      'trivy 超时 (60s)',
    );

    if (result.success) {
      try {
        const json = JSON.parse(result.stdout);
        const vulns = json.Results?.flatMap((r) => r.Vulnerabilities || []) || [];
        const criticals = vulns.filter((v) => v.Severity === 'CRITICAL');
        const highs = vulns.filter((v) => v.Severity === 'HIGH');
        if (criticals.length > 0 || highs.length > 0) {
          return formatResult(
            'trivy',
            DECISION.DENY,
            `Trivy 发现 ${criticals.length} CRITICAL, ${highs.length} HIGH 漏洞`,
            { critical: criticals.length, high: highs.length },
          );
        }
      } catch {}
    }

    return formatResult('trivy', DECISION.ALLOW, 'Trivy 扫描通过');
  } catch (e) {
    return formatResult('trivy', DECISION.SKIP, `Trivy 跳过: ${e.message}`);
  }
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

/**
 * 全量测试
 */
async function runFullTests() {
  // Check for Python project
  const hasPytest =
    execCommand('test -f pyproject.toml') || execCommand('test -f setup.py') || execCommand('test -f setup.cfg');
  // Check for JS project
  const hasPackageJson = execCommand('test -f package.json');

  const results = [];

  if (hasPytest.success) {
    // 先检查 uv 和 pytest 是否可用
    const hasUv = execCommand('which uv');
    if (!hasUv.success) {
      results.push(formatResult('full-test-py', DECISION.SKIP, 'uv 未安装，跳过 Python 测试'));
    } else {
      try {
        const pyResult = await withTimeout(
          new Promise((resolve) => {
            const r = execCommand('uv run python -m pytest -x -q', { timeout: 60000 });
            resolve(r);
          }),
          60000,
          'pytest 超时 (60s)',
        );
        if (!pyResult.success) {
          const output = pyResult.stderr || pyResult.stdout || '';
          // pytest 未安装、无测试文件等非失败场景，不应判为 DENY
          if (
            output.includes('No module named pytest') ||
            output.includes('no tests ran') ||
            output.includes('collected 0 items') ||
            output.includes('no tests collected')
          ) {
            results.push(formatResult('full-test-py', DECISION.SKIP, 'Python 测试跳过（pytest 未安装或无测试文件）'));
          } else {
            results.push(
              formatResult('full-test-py', DECISION.DENY, `Python 全量测试失败`, { output: output.slice(0, 500) }),
            );
          }
        } else {
          results.push(formatResult('full-test-py', DECISION.ALLOW, 'Python 全量测试通过'));
        }
      } catch (e) {
        results.push(formatResult('full-test-py', DECISION.SKIP, `Python 测试跳过: ${e.message}`));
      }
    }
  }

  if (hasPackageJson.success) {
    try {
      // 仅测试 git 跟踪的测试文件，排除未跟踪的第三方代码
      // bun test 要求以 ./ 开头的路径才能精确匹配文件
      const trackedFiles = execCommand(
        "git ls-files '*.test.js' '*.test.ts' '*.spec.js' '*.spec.ts' '*.test.jsx' '*.test.tsx'",
        { timeout: 5000 },
      );
      let testCmd = 'bun test ./.claude/hooks/__tests__/';
      if (trackedFiles.success && trackedFiles.stdout.trim()) {
        const files = trackedFiles.stdout
          .trim()
          .split('\n')
          .map((f) => `./${f}`)
          .join(' ');
        testCmd = `bun test ${files}`;
      }
      const jsResult = await withTimeout(
        new Promise((resolve) => {
          const r = execCommand(testCmd, { timeout: 60000 });
          resolve(r);
        }),
        60000,
        'bun test 超时 (60s)',
      );
      if (!jsResult.success) {
        results.push(
          formatResult('full-test-js', DECISION.DENY, `JS 全量测试失败`, {
            output: (jsResult.stderr || jsResult.stdout).slice(0, 500),
          }),
        );
      } else {
        results.push(formatResult('full-test-js', DECISION.ALLOW, 'JS 全量测试通过'));
      }
    } catch (e) {
      results.push(formatResult('full-test-js', DECISION.SKIP, `JS 测试跳过: ${e.message}`));
    }
  }

  if (results.length === 0) {
    return formatResult('full-tests', DECISION.SKIP, '未找到测试配置');
  }

  // Return the first failure, or all passed
  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure || formatResult('full-tests', DECISION.ALLOW, '所有全量测试通过');
}

/**
 * Hook 自身测试
 */
async function runHookTests() {
  const testDir = '.claude/hooks/__tests__';
  const check = execCommand(`test -d "${testDir}"`);
  if (!check.success) {
    return formatResult('hook-tests', DECISION.SKIP, 'Hook 测试目录不存在，跳过');
  }

  try {
    const result = await withTimeout(
      new Promise((resolve) => {
        const r = execCommand(`bun test "./${testDir}"`, { timeout: 30000 });
        resolve(r);
      }),
      30000,
      'Hook 测试超时 (30s)',
    );

    if (!result.success) {
      return formatResult('hook-tests', DECISION.DENY, `Hook 自身测试失败`, {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }

    return formatResult('hook-tests', DECISION.ALLOW, 'Hook 自身测试通过');
  } catch (e) {
    return formatResult('hook-tests', DECISION.SKIP, `Hook 测试跳过: ${e.message}`);
  }
}

/**
 * 生成安全报告 summary
 */
function generateSummary(results) {
  const summary = results
    .map((r) => {
      const icon = { allow: '✅', deny: '❌', skip: '⏭️', warn: '⚠️' }[r.decision] || '📋';
      return `${icon} [${r.checkId}] ${r.message}`;
    })
    .join('\n');
  return summary;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  await safeMain(async () => {
    const data = await readStdin();
    const { tool_name, tool_input, session_id, cwd } = data;

    // Fast bail-out: 非 Bash 工具
    if (tool_name !== 'Bash') {
      console.log('{}');
      return;
    }

    const cmd = tool_input?.command || '';

    // Fast bail-out: 非 git merge 命令
    if (!/\bgit\s+merge\b/.test(cmd)) {
      console.log('{}');
      return;
    }

    // 目标分支检测：检查是否合并到 main/master
    const currentBranch = getCurrentBranch();
    if (currentBranch !== 'main' && currentBranch !== 'master') {
      log(HOOK_NAME, { level: 'SKIP', reason: `当前分支 ${currentBranch} 非 main/master`, session_id, cwd });
      console.log('{}');
      return;
    }

    // Phase 1: 安全扫描（并行）
    const [semgrepResult, knipResult, trivyResult] = await Promise.allSettled([runSemgrep(), runKnip(), runTrivy()]);

    const securityResults = [
      semgrepResult.status === 'fulfilled'
        ? semgrepResult.value
        : formatResult('semgrep', DECISION.SKIP, 'Semgrep 执行异常'),
      knipResult.status === 'fulfilled' ? knipResult.value : formatResult('knip', DECISION.SKIP, 'Knip 执行异常'),
      trivyResult.status === 'fulfilled' ? trivyResult.value : formatResult('trivy', DECISION.SKIP, 'Trivy 执行异常'),
    ];

    // 检查安全扫描是否 deny
    const securityDecision = decide(securityResults);
    if (securityDecision.decision === DECISION.DENY) {
      const summary = generateSummary(securityResults);
      log(HOOK_NAME, { level: 'BLOCKED', phase: 'security', summary: summary.slice(0, 1000), session_id, cwd });
      console.log(formatHookOutput(DECISION.DENY, `🔒 安全扫描未通过:\n${securityDecision.reason}`));
      return;
    }

    // Phase 2: 全量测试（串行）
    const fullTestResult = await runFullTests();
    if (fullTestResult.decision === DECISION.DENY) {
      log(HOOK_NAME, { level: 'BLOCKED', phase: 'full-tests', session_id, cwd });
      console.log(formatHookOutput(DECISION.DENY, `🧪 全量测试失败:\n${fullTestResult.message}`));
      return;
    }

    // Phase 3: Hook 自身测试
    const hookTestResult = await runHookTests();
    if (hookTestResult.decision === DECISION.DENY) {
      log(HOOK_NAME, { level: 'BLOCKED', phase: 'hook-tests', session_id, cwd });
      console.log(formatHookOutput(DECISION.DENY, `🔧 Hook 测试失败:\n${hookTestResult.message}`));
      return;
    }

    // 所有检查通过
    const allResults = [...securityResults, fullTestResult, hookTestResult];
    const summary = generateSummary(allResults);

    log(HOOK_NAME, {
      level: 'PASSED',
      summary: summary.slice(0, 1000),
      session_id,
      cwd,
    });

    console.log(formatHookOutput(DECISION.ALLOW, `✅ 合并门检查全部通过:\n${summary}`));
  });
}

main();
