#!/usr/bin/env bun
/**
 * Commit Gate - PreToolUse Hook for Bash
 * 提交门：在 git commit 时执行多项安全检查
 *
 * 检查优先级：
 * 1. Fast bail-out：非 git commit 命令 → allow
 * 2. 分支检测：main/master → deny
 * 3. Message 格式：必须匹配 feat|fix|refactor|docs|test|chore|style|perf: 描述
 * 4. 暂存区敏感文件：.env, .ssh/id_*, *.pem, *.key 等 → deny
 * 5. 依赖审计：暂存区含 package.json/bun.lock 时触发 bun pm audit
 * 6. 全局类型检查：pyright + tsc --noEmit 并行
 * 7. 关联测试：仅对 .js/.ts/.py 文件查找关联测试
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
} from './security-orchestrator.js';

const HOOK_NAME = 'commit-gate';

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function extractCommitMessage(cmd) {
  const mMatch = cmd.match(/\bgit\s+commit\b[^"]*?-m\s+["']([^"']+)["']/);
  if (mMatch) return mMatch[1];
  const mMatch2 = cmd.match(/\bgit\s+commit\b.*?\s-m\s+([^\s-][^\s]*)/);
  if (mMatch2) return mMatch2[1];
  return null;
}

function getCurrentBranch() {
  const result = execCommand('git rev-parse --abbrev-ref HEAD');
  return result.success ? result.stdout.trim() : null;
}

function getStagedFiles() {
  const result = execCommand('git diff --cached --name-only');
  if (!result.success) return [];
  return result.stdout.trim().split('\n').filter(Boolean);
}

// ─── 检查函数 ─────────────────────────────────────────────────────────────────

function checkBranch() {
  const branch = getCurrentBranch();
  if (!branch) return formatResult('branch-check', DECISION.WARN, '无法获取当前分支名');
  if (branch === 'main' || branch === 'master') {
    return formatResult('branch-check', DECISION.DENY, `禁止在 ${branch} 分支上直接提交，请创建 feature 分支`);
  }
  return formatResult('branch-check', DECISION.ALLOW, `当前分支: ${branch}`);
}

function checkCommitMessage(cmd) {
  const message = extractCommitMessage(cmd);
  if (!message) {
    return formatResult('commit-msg', DECISION.DENY, '无法提取 commit message，请使用 -m "类型: 描述" 格式');
  }
  const pattern = /^(feat|fix|refactor|docs|test|chore|style|perf):\s+\S/;
  if (!pattern.test(message)) {
    return formatResult('commit-msg', DECISION.DENY, `Commit message 格式错误: "${message}" — 必须匹配 "类型: 描述"`);
  }
  return formatResult('commit-msg', DECISION.ALLOW, `Commit message 格式正确: "${message}"`);
}

function checkSensitiveFiles() {
  const sensitivePatterns = [
    /\.env$/,
    /\.env\.local$/,
    /\.env\.production$/,
    /\.ssh\/id_/,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /\.pfx$/,
    /credentials\.json$/,
  ];
  const stagedFiles = getStagedFiles();
  const matched = stagedFiles.filter((f) => sensitivePatterns.some((p) => p.test(f)));
  if (matched.length > 0) {
    return formatResult('sensitive-files', DECISION.DENY, `暂存区包含敏感文件: ${matched.join(', ')}`, {
      files: matched,
    });
  }
  return formatResult('sensitive-files', DECISION.ALLOW, '暂存区无敏感文件');
}

async function checkDependencyAudit() {
  const stagedFiles = getStagedFiles();
  const triggers = ['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock'];
  const hasTrigger = stagedFiles.some((f) => triggers.some((t) => f.endsWith(t)));
  if (!hasTrigger) {
    return formatResult('dep-audit', DECISION.SKIP, '暂存区无依赖文件变更，跳过审计');
  }
  try {
    const result = await withTimeout(
      new Promise((resolve) => {
        resolve(execCommand('bun pm audit --json', { timeout: 5000 }));
      }),
      5000,
      'bun pm audit 超时 (5s)',
    );
    if (result.success) return formatResult('dep-audit', DECISION.ALLOW, '依赖审计通过');
    const output = result.stdout + result.stderr;
    const hasCritical = /critical/i.test(output);
    const hasHigh = /high/i.test(output);
    if (hasCritical || hasHigh) {
      return formatResult('dep-audit', DECISION.DENY, `依赖审计发现漏洞`, { output: output.slice(0, 500) });
    }
    return formatResult('dep-audit', DECISION.ALLOW, '依赖审计通过（无 critical/high 漏洞）');
  } catch (e) {
    return formatResult('dep-audit', DECISION.SKIP, `依赖审计跳过: ${e.message}`);
  }
}

async function checkTypeScript() {
  const pyrightPromise = new Promise((resolve) => {
    const hasPyright = execCommand('which pyright');
    if (hasPyright.success) {
      const r = execCommand('pyright', { timeout: 30000 });
      resolve({ tool: 'pyright', ...r });
    } else {
      const hasUv = execCommand('which uv');
      if (hasUv.success) {
        const r = execCommand('uv run pyright', { timeout: 30000 });
        resolve({ tool: 'pyright (uv)', ...r });
      } else {
        resolve({ tool: 'pyright', success: true, stdout: 'pyright not found, skip', stderr: '' });
      }
    }
  });

  const tscPromise = new Promise((resolve) => {
    const hasTsconfig = execCommand('test -f tsconfig.json');
    if (!hasTsconfig.success) {
      resolve({ tool: 'tsc', success: true, stdout: 'no tsconfig.json, skip', stderr: '' });
      return;
    }
    const r = execCommand('bunx tsc --noEmit', { timeout: 30000 });
    resolve({ tool: 'tsc', ...r });
  });

  try {
    const results = await Promise.allSettled([
      withTimeout(pyrightPromise, 30000, 'pyright 超时 (30s)'),
      withTimeout(tscPromise, 30000, 'tsc 超时 (30s)'),
    ]);

    const failures = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && !r.value.success) {
        failures.push(r.value);
      }
    }
    if (failures.length > 0) {
      const messages = failures.map((f) => `${f.tool}: ${(f.stderr || f.stdout).slice(0, 200)}`).join('\n');
      return formatResult('type-check', DECISION.DENY, `类型检查失败:\n${messages}`, { failures });
    }
    return formatResult('type-check', DECISION.ALLOW, '类型检查通过');
  } catch (e) {
    return formatResult('type-check', DECISION.SKIP, `类型检查跳过: ${e.message}`);
  }
}

async function checkRelatedTests() {
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    return formatResult('related-tests', DECISION.SKIP, '无暂存文件，跳过关联测试');
  }

  // Only check tests for code files (.js, .ts, .py)
  const codeFiles = stagedFiles.filter((f) => /\.(js|ts|py|jsx|tsx|mjs|cjs)$/i.test(f));
  if (codeFiles.length === 0) {
    return formatResult('related-tests', DECISION.SKIP, '暂存区无代码文件，跳过关联测试');
  }

  const testPatterns = [
    (f) => f.replace(/\.py$/, '_test.py').replace(/\/src\//, '/tests/'),
    (f) => f.replace(/\.py$/, '_test.py'),
    (f) => f.replace(/\.(js|ts)$/, '.test.$1'),
    (f) => f.replace(/\.(js|ts)$/, '.spec.$1'),
    (f) => f.replace(/\/src\//, '/__tests__/').replace(/\.(js|ts)$/, '.test.$1'),
  ];

  const testFiles = new Set();
  for (const file of codeFiles) {
    for (const pattern of testPatterns) {
      const candidate = pattern(file);
      // Only add if candidate is different from original (actual test file)
      if (candidate !== file) {
        const check = execCommand(`test -f "${candidate}"`);
        if (check.success) testFiles.add(candidate);
      }
    }
  }

  if (testFiles.size === 0) {
    return formatResult('related-tests', DECISION.SKIP, '未找到关联测试文件');
  }

  const testFileList = [...testFiles];
  try {
    const isPython = testFileList.some((f) => f.endsWith('.py'));
    const isJs = testFileList.some((f) => /\.(js|ts)$/.test(f));

    if (isPython && isJs) {
      const pyFiles = testFileList.filter((f) => f.endsWith('.py'));
      const jsFiles = testFileList.filter((f) => /\.(js|ts)$/.test(f));
      const pyCmd = `uv run python -m pytest ${pyFiles.map((f) => `"${f}"`).join(' ')} -x -q`;
      const jsCmd = `bun test ${jsFiles.map((f) => `"${f}"`).join(' ')}`;
      const pyResult = await withTimeout(
        new Promise((resolve) => resolve(execCommand(pyCmd, { timeout: 30000 }))),
        30000,
        'pytest 超时 (30s)',
      );
      if (!pyResult.success) {
        return formatResult('related-tests', DECISION.DENY, '关联 Python 测试失败', {
          output: (pyResult.stderr || pyResult.stdout).slice(0, 500),
        });
      }
      const jsResult = await withTimeout(
        new Promise((resolve) => resolve(execCommand(jsCmd, { timeout: 30000 }))),
        30000,
        'bun test 超时 (30s)',
      );
      if (!jsResult.success) {
        return formatResult('related-tests', DECISION.DENY, '关联 JS 测试失败', {
          output: (jsResult.stderr || jsResult.stdout).slice(0, 500),
        });
      }
      return formatResult('related-tests', DECISION.ALLOW, '所有关联测试通过');
    }

    const cmd = isPython
      ? `uv run python -m pytest ${testFileList.map((f) => `"${f}"`).join(' ')} -x -q`
      : `bun test ${testFileList.map((f) => `"${f}"`).join(' ')}`;

    const result = await withTimeout(
      new Promise((resolve) => resolve(execCommand(cmd, { timeout: 30000 }))),
      30000,
      '关联测试超时 (30s)',
    );

    if (!result.success) {
      return formatResult('related-tests', DECISION.DENY, `关联测试失败: ${testFileList.join(', ')}`, {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }

    return formatResult('related-tests', DECISION.ALLOW, `关联测试通过: ${testFileList.join(', ')}`);
  } catch (e) {
    return formatResult('related-tests', DECISION.SKIP, `关联测试跳过: ${e.message}`);
  }
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  await safeMain(async () => {
    const data = await readStdin();
    const { tool_name, tool_input, session_id, cwd } = data;

    if (tool_name !== 'Bash') {
      console.log('{}');
      return;
    }

    const cmd = tool_input?.command || '';
    if (!/\bgit\s+commit\b/.test(cmd)) {
      console.log('{}');
      return;
    }

    // Phase 1: 同步检查
    const branchResult = checkBranch();
    const msgResult = checkCommitMessage(cmd);
    const sensitiveResult = checkSensitiveFiles();

    const syncResults = [branchResult, msgResult, sensitiveResult];
    const syncDecision = decide(syncResults);
    if (syncDecision.decision === DECISION.DENY) {
      log(HOOK_NAME, { level: 'BLOCKED', phase: 'sync', checks: syncResults.map((r) => r.checkId), session_id, cwd });
      console.log(formatHookOutput(DECISION.DENY, syncDecision.reason));
      return;
    }

    // Phase 2: 并行异步检查
    const [auditResult, typeResult, testResult] = await Promise.all([
      checkDependencyAudit(),
      checkTypeScript(),
      checkRelatedTests(),
    ]);

    const allResults = [...syncResults, auditResult, typeResult, testResult];
    const finalDecision = decide(allResults);

    log(HOOK_NAME, {
      level: finalDecision.decision === DECISION.DENY ? 'BLOCKED' : 'PASSED',
      checks: allResults.map((r) => ({ id: r.checkId, decision: r.decision, message: r.message.slice(0, 100) })),
      session_id,
      cwd,
    });

    console.log(formatHookOutput(finalDecision.decision, finalDecision.reason));
  });
}

main();
