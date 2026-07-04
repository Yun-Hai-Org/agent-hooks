import { join } from 'path';
import { parseCoverageMetrics, evaluateCoverageAgainstThresholds } from './coverage.js';
import { resolveCoverageThresholds } from '../gate-config.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';
import {
  execCommand,
  execCommandAsync,
  formatResult,
  withTimeout,
  detectToolchain,
  DECISION,
} from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { getScopedStagedFiles } from './scan-scope.js';
import { denyIfToolMissing, denyOnToolError, isToolInstalled, resolveBunExecutable } from './tools.js';
import { isHooksProject } from './hooks-project.js';

const ADVERSARIAL_DIR = '.claude/hooks/__tests__/adversarial';
const HOOK_TESTS_DIR = '.claude/hooks/__tests__';

function bunTestCommand(args: string): string {
  return `"${resolveBunExecutable()}" test ${args}`;
}

export async function runRelatedTests(cwd?: string, _options?: GateCheckRunOptions) {
  const stagedFiles = getScopedStagedFiles(cwd);
  if (stagedFiles.length === 0) {
    return formatResult('related-tests', DECISION.SKIP, '无暂存文件，跳过关联测试');
  }

  const codeFiles = stagedFiles.filter((f) => /\.(js|ts|py|jsx|tsx|mjs|cjs)$/i.test(f));
  if (codeFiles.length === 0) {
    return formatResult('related-tests', DECISION.SKIP, '暂存区无代码文件，跳过关联测试');
  }

  const testPatterns: ((f: string) => string)[] = [
    (f) => f.replace(/\.py$/, '_test.py').replace(/\/src\//, '/tests/'),
    (f) => f.replace(/\.py$/, '_test.py'),
    (f) => f.replace(/\.(js|ts)$/, '.test.$1'),
    (f) => f.replace(/\.(js|ts)$/, '.spec.$1'),
    (f) => f.replace(/\/src\//, '/__tests__/').replace(/\.(js|ts)$/, '.test.$1'),
  ];

  const testFiles = new Set<string>();
  for (const file of codeFiles) {
    for (const pattern of testPatterns) {
      const candidate = pattern(file);
      if (candidate !== file && execCommand(`test -f "${candidate}"`, { cwd }).success) {
        testFiles.add(candidate);
      }
    }
  }

  if (testFiles.size === 0) {
    return formatResult('related-tests', DECISION.SKIP, '未找到关联测试文件');
  }

  const testFileList = [...testFiles];
  const isPython = testFileList.some((f) => f.endsWith('.py'));
  const isJs = testFileList.some((f) => /\.(js|ts)$/.test(f));

  if (isPython) {
    const missing = denyIfToolMissing('uv', 'related-tests', cwd);
    if (missing) return missing;
  }
  if (isJs) {
    const missing = denyIfToolMissing('bun', 'related-tests', cwd);
    if (missing) return missing;
  }

  try {
    if (isPython && isJs) {
      const pyFiles = testFileList.filter((f) => f.endsWith('.py'));
      const jsFiles = testFileList.filter((f) => /\.(js|ts)$/.test(f));
      const pyResult = await withTimeout(
        Promise.resolve(
          execCommand(`uv run python -m pytest ${pyFiles.map((f) => `"${f}"`).join(' ')} -x -q`, {
            cwd,
            timeout: 30000,
          }),
        ),
        30000,
        'pytest 超时 (30s)',
      );
      if (!pyResult.success) {
        const output = [pyResult.stdout, pyResult.stderr].filter(Boolean).join('\n');
        if (output.includes('No module named pytest')) {
          return formatResult('related-tests', DECISION.DENY, 'pytest 未安装，请先 uv add pytest');
        }
        return formatResult('related-tests', DECISION.DENY, '关联 Python 测试失败', { output: output.slice(0, 500) });
      }
      const jsResult = await withTimeout(
        Promise.resolve(execCommand(bunTestCommand(jsFiles.map((f) => `"${f}"`).join(' ')), { cwd, timeout: 30000 })),
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
      : bunTestCommand(testFileList.map((f) => `"${f}"`).join(' '));

    const result = await withTimeout(
      Promise.resolve(execCommand(cmd, { cwd, timeout: 30000 })),
      30000,
      '关联测试超时 (30s)',
    );
    if (!result.success) {
      const output = result.stderr || result.stdout || '';
      if (isPython && output.includes('No module named pytest')) {
        return formatResult('related-tests', DECISION.DENY, 'pytest 未安装，请先 uv add pytest');
      }
      return formatResult('related-tests', DECISION.DENY, `关联测试失败: ${testFileList.join(', ')}`, {
        output: output.slice(0, 500),
      });
    }
    return formatResult('related-tests', DECISION.ALLOW, `关联测试通过: ${testFileList.join(', ')}`);
  } catch (e) {
    return denyOnToolError(e, 'related-tests', isPython ? 'pytest' : 'bun test');
  }
}

export async function runFullProjectTests(cwd?: string, _options?: GateCheckRunOptions) {
  const toolchain = detectToolchain(cwd);
  const results: CheckResult[] = [];

  if (toolchain.python === 'uv') {
    if (!isToolInstalled('uv', cwd)) {
      results.push(formatResult('full-test-py', DECISION.DENY, 'uv 未安装，请先安装 uv'));
    } else {
      try {
        const thresholds = resolveCoverageThresholds(cwd);
        const pyResult = await withTimeout(
          execCommandAsync(`uv run python -m pytest -x -q --cov --cov-fail-under=${String(thresholds.lines)}`, {
            cwd,
            timeout: 120000,
          }),
          120000,
          'pytest 超时 (120s)',
        );
        if (!pyResult.success) {
          const output = [pyResult.stdout, pyResult.stderr].filter(Boolean).join('\n');
          if (output.includes('No module named pytest')) {
            results.push(formatResult('full-test-py', DECISION.DENY, 'pytest 未安装，请先 uv add pytest'));
          } else if (output.includes('No module named pytest_cov') || output.includes('unknown option: --cov')) {
            results.push(formatResult('full-test-py', DECISION.DENY, 'pytest-cov 未安装，请先 uv add pytest-cov'));
          } else if (output.includes('no tests ran') || output.includes('collected 0 items')) {
            results.push(formatResult('full-test-py', DECISION.SKIP, '无 Python 测试用例'));
          } else {
            results.push(
              formatResult('full-test-py', DECISION.DENY, 'Python 全量测试失败', { output: output.slice(0, 500) }),
            );
          }
        } else {
          results.push(formatResult('full-test-py', DECISION.ALLOW, 'Python 全量测试通过'));
        }
      } catch (e) {
        results.push(denyOnToolError(e, 'full-test-py', 'pytest'));
      }
    }
  }

  if (toolchain.js === 'bun') {
    if (!isToolInstalled('bun', cwd)) {
      results.push(formatResult('full-test-js', DECISION.DENY, 'bun 未安装，请先安装 bun'));
    } else {
      try {
        const trackedFiles = execCommand("git ls-files '*.test.js' '*.test.ts' '*.spec.js' '*.spec.ts'", {
          cwd,
          timeout: 5000,
        });
        const projectTestFiles = trackedFiles.success
          ? trackedFiles.stdout
              .trim()
              .split('\n')
              .filter(Boolean)
              .filter((f) => !f.includes('.claude/hooks/__tests__'))
          : [];
        if (projectTestFiles.length === 0) {
          results.push(
            formatResult('full-test-js', DECISION.SKIP, '无项目级 JS 测试（hook 测试由 hook-unit-tests 覆盖）'),
          );
        } else {
          const files = projectTestFiles.map((f) => `./${f}`).join(' ');
          const jsResult = await withTimeout(
            execCommandAsync(bunTestCommand(`${files} --coverage`), { cwd, timeout: 120000 }),
            120000,
            'bun test 超时 (120s)',
          );
          const output = jsResult.stdout + jsResult.stderr;
          if (!jsResult.success) {
            results.push(
              formatResult('full-test-js', DECISION.DENY, 'JS 全量测试失败', {
                output: output.slice(0, 500),
              }),
            );
          } else {
            const metrics = parseCoverageMetrics(output);
            const thresholds = resolveCoverageThresholds(cwd);
            const evaluation = evaluateCoverageAgainstThresholds(metrics, thresholds);
            if (!evaluation.pass) {
              results.push(
                formatResult('full-test-js', DECISION.DENY, evaluation.message, {
                  output: output.slice(0, 500),
                }),
              );
            } else {
              results.push(formatResult('full-test-js', DECISION.ALLOW, `JS 全量测试通过，${evaluation.message}`));
            }
          }
        }
      } catch (e) {
        results.push(denyOnToolError(e, 'full-test-js', 'bun test'));
      }
    }
  }

  results.push(await runShellTests(cwd, _options));

  if (results.length === 0) {
    return formatResult('full-tests', DECISION.SKIP, '未找到测试配置');
  }
  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure ?? formatResult('full-tests', DECISION.ALLOW, '所有全量测试通过');
}

const SHELL_TESTS_DIR = 'tests/shell';
const SHELL_COVERAGE_SCRIPT = 'scripts/run-shell-coverage.sh';

export async function runShellTests(cwd?: string, _options?: GateCheckRunOptions): Promise<CheckResult> {
  if (!execCommand(`test -d "${SHELL_TESTS_DIR}"`, { cwd }).success) {
    return formatResult('full-test-sh', DECISION.SKIP, '无 tests/shell 目录，跳过 Shell 测试');
  }

  if (!isToolInstalled('bats', cwd)) {
    return formatResult('full-test-sh', DECISION.SKIP, 'bats 未安装，跳过 Shell 测试');
  }

  try {
    const batsResult = await withTimeout(
      execCommandAsync(`bats "${SHELL_TESTS_DIR}"`, { cwd, timeout: 120000 }),
      120000,
      'bats 超时 (120s)',
    );
    if (!batsResult.success) {
      const output = [batsResult.stdout, batsResult.stderr].filter(Boolean).join('\n');
      return formatResult('full-test-sh', DECISION.DENY, 'Shell bats 测试失败', { output: output.slice(0, 500) });
    }

    if (execCommand(`test -x "${SHELL_COVERAGE_SCRIPT}"`, { cwd }).success) {
      const kcovResult = await withTimeout(
        execCommandAsync(`"${SHELL_COVERAGE_SCRIPT}"`, { cwd, timeout: 120000 }),
        120000,
        'Shell 覆盖率脚本超时 (120s)',
      );
      if (!kcovResult.success) {
        const output = [kcovResult.stdout, kcovResult.stderr].filter(Boolean).join('\n');
        return formatResult('full-test-sh', DECISION.DENY, 'Shell 覆盖率脚本失败', { output: output.slice(0, 500) });
      }
    }

    return formatResult('full-test-sh', DECISION.ALLOW, 'Shell bats 测试通过');
  } catch (e) {
    return denyOnToolError(e, 'full-test-sh', 'bats');
  }
}

const HOOK_UNIT_TEST_TIMEOUT_MS = 1200000;
const HOOK_UNIT_TEST_GLOB = process.env['HOOK_UNIT_TEST_GLOB'] ?? './.claude/hooks/__tests__/*.test.ts';
const HOOK_UNIT_TEST_EXEC_OPTS = { maxBuffer: 64 * 1024 * 1024, shell: '/bin/sh' as const };

export interface BunTestRunSummary {
  failCount: number;
  passCount?: number;
  parsed: boolean;
}

export function parseBunTestRunSummary(output: string): BunTestRunSummary {
  const ranMatch = /Ran (\d+) tests across \d+ files/gm;
  let lastRanIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = ranMatch.exec(output)) !== null) {
    lastRanIndex = match.index;
  }
  if (lastRanIndex !== -1) {
    const tail = output.slice(Math.max(0, lastRanIndex - 300), lastRanIndex);
    const block = /(\d+)\s+pass(?:ed)?\s*\n\s*(\d+)\s+fail\b/m.exec(tail);
    if (block) {
      return {
        failCount: Number(block[2]),
        passCount: Number(block[1]),
        parsed: true,
      };
    }
  }

  const failMatches = [...output.matchAll(/(\d+)\s+fail\b/g)];
  const lastFail = failMatches.at(-1);
  const failCount = lastFail?.[1] !== undefined ? Number(lastFail[1]) : 0;

  const passOnly = /(\d+)\s+pass(?:ed)?\b/i.exec(output);
  const failOnly = failMatches.length > 0;
  if (passOnly || failOnly || /\b0\s+fail\b/.test(output)) {
    return { failCount, ...(passOnly ? { passCount: Number(passOnly[1]) } : {}), parsed: true };
  }

  return { failCount: 0, parsed: false };
}

export async function runHookUnitTests(cwd?: string, options: GateCheckRunOptions = {}) {
  const unitTestTimeoutMs = options.timeoutMs ?? HOOK_UNIT_TEST_TIMEOUT_MS;
  if (!isHooksProject(cwd)) {
    return formatResult('hook-unit-tests', DECISION.SKIP, '非 hooks 项目，跳过 Hook 单测');
  }

  const missing = denyIfToolMissing('bun', 'hook-unit-tests', cwd);
  if (missing) return missing;

  if (!execCommand(`test -d "${HOOK_TESTS_DIR}"`, { cwd }).success) {
    return formatResult('hook-unit-tests', DECISION.DENY, 'Hook 测试目录不存在');
  }
  const list = execCommand(`find ${HOOK_TESTS_DIR} -maxdepth 1 -name "*.test.ts"`, { cwd, timeout: 5000 });
  const files = list.success ? list.stdout.trim().split('\n').filter(Boolean) : [];
  if (files.length === 0) {
    return formatResult('hook-unit-tests', DECISION.DENY, '无 Hook 常规单测文件');
  }
  try {
    const withCoverage = options.coverageThreshold !== undefined;
    const flags = withCoverage ? ' --coverage' : ' --dots';
    const cmd = bunTestCommand(`${HOOK_UNIT_TEST_GLOB}${flags} --concurrency=1`);
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信 hooks 仓库根，第二段为常量测试 stub 路径
    const emptyGlobalPath = join(cwd ?? process.cwd(), '.claude/hooks/__tests__/empty-global-quality-gate.yaml');
    const result = await withTimeout(
      execCommandAsync(cmd, {
        cwd,
        timeout: unitTestTimeoutMs,
        ...HOOK_UNIT_TEST_EXEC_OPTS,
        env: { ...process.env, QUALITY_GATE_GLOBAL_CONFIG_PATH: emptyGlobalPath },
      }),
      unitTestTimeoutMs,
      `Hook 常规单测超时 (${String(unitTestTimeoutMs / 1000)}s)`,
    );
    const combinedOutput = result.stdout + result.stderr;
    const summary = parseBunTestRunSummary(combinedOutput);
    const success = summary.parsed ? summary.failCount === 0 : result.success;

    if (!success) {
      const tail = combinedOutput.trim().split('\n').slice(-3).join('\n');
      return formatResult('hook-unit-tests', DECISION.DENY, `Hook 常规单测失败${tail ? `\n${tail}` : ''}`, {
        output: combinedOutput.slice(0, 500),
      });
    }
    if (withCoverage) {
      const thresholds = options.coverageThreshold;
      if (thresholds === undefined) {
        return formatResult('hook-unit-tests', DECISION.DENY, 'Hook 覆盖率阈值未配置');
      }
      const metrics = parseCoverageMetrics(combinedOutput);
      const evaluation = evaluateCoverageAgainstThresholds(metrics, thresholds);
      if (!evaluation.pass) {
        return formatResult('hook-unit-tests', DECISION.DENY, evaluation.message, {
          output: combinedOutput.slice(0, 500),
        });
      }
      return formatResult('hook-unit-tests', DECISION.ALLOW, `Hook 常规单测通过，${evaluation.message}`, {
        coverageReport: combinedOutput,
      });
    }
    return formatResult('hook-unit-tests', DECISION.ALLOW, 'Hook 常规单测通过');
  } catch (e) {
    return denyOnToolError(e, 'hook-unit-tests', 'bun test');
  }
}

export async function runHookAdversarialIfStaged(cwd?: string, _options?: GateCheckRunOptions) {
  const stagedFiles = getStagedFiles(cwd);
  const touchesHooks = stagedFiles.some((f) => f.startsWith('.claude/hooks/'));
  if (!touchesHooks) {
    return formatResult('hook-adversarial', DECISION.SKIP, '暂存区未修改 hooks，跳过对抗性测试');
  }
  return runHookAdversarialTests(cwd);
}

export async function runHookAdversarialTests(cwd?: string, _options?: GateCheckRunOptions) {
  if (!isHooksProject(cwd)) {
    return formatResult('hook-adversarial', DECISION.SKIP, '非 hooks 项目，跳过对抗性测试');
  }

  const missing = denyIfToolMissing('bun', 'hook-adversarial', cwd);
  if (missing) return missing;

  if (!execCommand(`test -d "${ADVERSARIAL_DIR}"`, { cwd }).success) {
    return formatResult('hook-adversarial', DECISION.DENY, '对抗性测试目录不存在');
  }
  const list = execCommand(`find ${ADVERSARIAL_DIR} -maxdepth 1 -name "*.test.ts"`, {
    cwd,
    timeout: 5000,
  });
  const files = list.success ? list.stdout.trim().split('\n').filter(Boolean) : [];
  if (files.length === 0) {
    return formatResult('hook-adversarial', DECISION.DENY, '无对抗性测试文件');
  }
  try {
    const cmd = bunTestCommand(files.map((f) => `"./${f}"`).join(' '));
    const result = await withTimeout(execCommandAsync(cmd, { cwd, timeout: 60000 }), 60000, '对抗性测试超时 (60s)');
    if (!result.success) {
      return formatResult('hook-adversarial', DECISION.DENY, 'Hook 对抗性测试失败', {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }
    return formatResult('hook-adversarial', DECISION.ALLOW, 'Hook 对抗性测试通过');
  } catch (e) {
    return denyOnToolError(e, 'hook-adversarial', 'bun test');
  }
}
