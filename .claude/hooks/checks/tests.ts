import { join } from 'path';
import { parseCoveragePercent, BUSINESS_COVERAGE_THRESHOLD } from './coverage.js';
import type { CheckResult } from '../types.js';
import {
  execCommand,
  execCommandAsync,
  formatResult,
  withTimeout,
  detectToolchain,
  TESTS_DIR,
  DECISION,
} from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { denyIfToolMissing, denyOnToolError, isToolInstalled, resolveBunExecutable } from './tools.js';
import { isHooksProject } from './hooks-project.js';

const ADVERSARIAL_DIR = join(TESTS_DIR, 'adversarial');

function bunTestCommand(args: string): string {
  return `"${resolveBunExecutable()}" test ${args}`;
}

export async function runRelatedTests(cwd?: string) {
  const stagedFiles = getStagedFiles(cwd);
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

export async function runFullProjectTests(cwd?: string) {
  const toolchain = detectToolchain(cwd);
  const results: CheckResult[] = [];

  if (toolchain.python === 'uv') {
    if (!isToolInstalled('uv', cwd)) {
      results.push(formatResult('full-test-py', DECISION.DENY, 'uv 未安装，请先安装 uv'));
    } else {
      try {
        const pyResult = await withTimeout(
          execCommandAsync('uv run python -m pytest -x -q', { cwd, timeout: 120000 }),
          120000,
          'pytest 超时 (120s)',
        );
        if (!pyResult.success) {
          const output = [pyResult.stdout, pyResult.stderr].filter(Boolean).join('\n');
          if (output.includes('No module named pytest')) {
            results.push(formatResult('full-test-py', DECISION.DENY, 'pytest 未安装，请先 uv add pytest'));
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
            const pct = parseCoveragePercent(output);
            if (pct !== null && pct < BUSINESS_COVERAGE_THRESHOLD) {
              results.push(
                formatResult(
                  'full-test-js',
                  DECISION.DENY,
                  `业务 JS 测试通过但覆盖率 ${String(pct)}% 低于 ${String(BUSINESS_COVERAGE_THRESHOLD)}%`,
                  { output: output.slice(0, 500) },
                ),
              );
            } else {
              results.push(
                formatResult(
                  'full-test-js',
                  DECISION.ALLOW,
                  pct === null ? 'JS 全量测试通过' : `JS 全量测试通过，覆盖率 ${String(pct)}%`,
                ),
              );
            }
          }
        }
      } catch (e) {
        results.push(denyOnToolError(e, 'full-test-js', 'bun test'));
      }
    }
  }

  if (results.length === 0) {
    return formatResult('full-tests', DECISION.SKIP, '未找到测试配置');
  }
  const failure = results.find((r) => r.decision === DECISION.DENY);
  return failure ?? formatResult('full-tests', DECISION.ALLOW, '所有全量测试通过');
}

const HOOK_UNIT_TEST_BATCH_SIZE = 8;
const HOOK_UNIT_TEST_BATCH_TIMEOUT_MS = 600000;

export async function runHookUnitTests(cwd?: string, options: { coverageThreshold?: number } = {}) {
  if (!isHooksProject(cwd)) {
    return formatResult('hook-unit-tests', DECISION.SKIP, '非 hooks 项目，跳过 Hook 单测');
  }

  const missing = denyIfToolMissing('bun', 'hook-unit-tests', cwd);
  if (missing) return missing;

  if (!execCommand(`test -d "${TESTS_DIR}"`, { cwd }).success) {
    return formatResult('hook-unit-tests', DECISION.DENY, 'Hook 测试目录不存在');
  }
  const list = execCommand('find .claude/hooks/__tests__ -maxdepth 1 -name "*.test.ts"', { cwd, timeout: 5000 });
  const files = list.success ? list.stdout.trim().split('\n').filter(Boolean) : [];
  if (files.length === 0) {
    return formatResult('hook-unit-tests', DECISION.DENY, '无 Hook 常规单测文件');
  }
  try {
    let combinedOutput = '';
    for (let i = 0; i < files.length; i += HOOK_UNIT_TEST_BATCH_SIZE) {
      const batch = files.slice(i, i + HOOK_UNIT_TEST_BATCH_SIZE);
      const cmd = bunTestCommand(`${batch.map((f) => `"./${f}"`).join(' ')} --dots`);
      const result = await withTimeout(
        execCommandAsync(cmd, { cwd, timeout: HOOK_UNIT_TEST_BATCH_TIMEOUT_MS }),
        HOOK_UNIT_TEST_BATCH_TIMEOUT_MS,
        `Hook 常规单测超时 (${String(HOOK_UNIT_TEST_BATCH_TIMEOUT_MS / 1000)}s)`,
      );
      combinedOutput += result.stdout + result.stderr;
      if (!result.success) {
        return formatResult('hook-unit-tests', DECISION.DENY, 'Hook 常规单测失败', {
          output: combinedOutput.slice(0, 500),
        });
      }
    }
    if (options.coverageThreshold !== undefined) {
      const allFiles = files.map((f) => `"./${f}"`).join(' ');
      const coverageResult = await withTimeout(
        execCommandAsync(bunTestCommand(`${allFiles} --coverage --dots`), {
          cwd,
          timeout: HOOK_UNIT_TEST_BATCH_TIMEOUT_MS,
        }),
        HOOK_UNIT_TEST_BATCH_TIMEOUT_MS,
        `Hook 覆盖率测试超时 (${String(HOOK_UNIT_TEST_BATCH_TIMEOUT_MS / 1000)}s)`,
      );
      combinedOutput += coverageResult.stdout + coverageResult.stderr;
      if (!coverageResult.success) {
        return formatResult('hook-unit-tests', DECISION.DENY, 'Hook 覆盖率测试失败', {
          output: combinedOutput.slice(0, 500),
        });
      }
      const pct = parseCoveragePercent(coverageResult.stdout + coverageResult.stderr);
      if (pct === null || pct < options.coverageThreshold) {
        return formatResult(
          'hook-unit-tests',
          DECISION.DENY,
          pct === null
            ? `Hook 单测通过但无法解析覆盖率（要求 >= ${String(options.coverageThreshold)}%）`
            : `Hook 单测通过但覆盖率 ${String(pct)}% 低于 ${String(options.coverageThreshold)}%`,
          { output: combinedOutput.slice(0, 500) },
        );
      }
      return formatResult('hook-unit-tests', DECISION.ALLOW, `Hook 常规单测通过，覆盖率 ${String(pct)}% 达标`);
    }
    return formatResult('hook-unit-tests', DECISION.ALLOW, 'Hook 常规单测通过');
  } catch (e) {
    return denyOnToolError(e, 'hook-unit-tests', 'bun test');
  }
}

export async function runHookAdversarialIfStaged(cwd?: string) {
  const stagedFiles = getStagedFiles(cwd);
  const touchesHooks = stagedFiles.some((f) => f.startsWith('.claude/hooks/'));
  if (!touchesHooks) {
    return formatResult('hook-adversarial', DECISION.SKIP, '暂存区未修改 hooks，跳过对抗性测试');
  }
  return runHookAdversarialTests(cwd);
}

export async function runHookAdversarialTests(cwd?: string) {
  if (!isHooksProject(cwd)) {
    return formatResult('hook-adversarial', DECISION.SKIP, '非 hooks 项目，跳过对抗性测试');
  }

  const missing = denyIfToolMissing('bun', 'hook-adversarial', cwd);
  if (missing) return missing;

  if (!execCommand(`test -d "${ADVERSARIAL_DIR}"`, { cwd }).success) {
    return formatResult('hook-adversarial', DECISION.DENY, '对抗性测试目录不存在');
  }
  const list = execCommand('find .claude/hooks/__tests__/adversarial -maxdepth 1 -name "*.test.ts"', {
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
