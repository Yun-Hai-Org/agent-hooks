import { basename } from 'path';
import { resolveTestFilePairingConfig } from '../gate-config.js';
import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';
import { getScopedStagedFiles } from './scan-scope.js';
import { matchGlobPattern } from './diff-coverage.js';
import type { CheckResult } from '../types.js';

const TEST_PATH_PATTERNS: ((f: string) => string)[] = [
  (f) => f.replace(/\.py$/, '_test.py').replace(/\/src\//, '/tests/'),
  (f) => f.replace(/\.py$/, '_test.py'),
  (f) => f.replace(/\.(js|ts)$/, '.test.$1'),
  (f) => f.replace(/\.(js|ts)$/, '.spec.$1'),
  (f) => f.replace(/\/src\//, '/__tests__/').replace(/\.(js|ts)$/, '.test.$1'),
  (f) => `tests/shell/${basename(f).replace(/\.sh$/, '')}.bats`,
];

function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((p) => matchGlobPattern(path, p));
}

function isTestFile(path: string): boolean {
  return (
    /\.(test|spec)\.(ts|js|tsx|jsx|mjs|cjs)$/i.test(path) ||
    /_test\.py$/i.test(path) ||
    /\.bats$/i.test(path) ||
    path.includes('/__tests__/')
  );
}

function isSourceFile(path: string, sourceGlobs: string[], exclude: string[]): boolean {
  if (isTestFile(path)) return false;
  if (!matchesAnyGlob(path, sourceGlobs)) return false;
  if (matchesAnyGlob(path, exclude)) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|sh)$/i.test(path);
}

export function candidateTestPaths(sourceFile: string): string[] {
  const candidates = new Set<string>();
  for (const pattern of TEST_PATH_PATTERNS) {
    const candidate = pattern(sourceFile);
    if (candidate !== sourceFile) candidates.add(candidate);
  }
  return [...candidates];
}

export function hasPairedTest(sourceFile: string, stagedFiles: string[], cwd?: string): boolean {
  const stagedSet = new Set(stagedFiles);
  for (const candidate of candidateTestPaths(sourceFile)) {
    if (stagedSet.has(candidate)) return true;
    if (execCommand(`test -f "${candidate}"`, { cwd }).success) return true;
  }
  return false;
}

export function runTestFilePairing(cwd?: string): CheckResult {
  const root = cwd ?? process.cwd();
  const config = resolveTestFilePairingConfig(root);

  if (!config.enabled) {
    return formatResult('test-file-pairing', DECISION.SKIP, 'testFilePairing 未启用，跳过');
  }

  if (!config.enforceOn.includes('commit')) {
    return formatResult('test-file-pairing', DECISION.SKIP, 'testFilePairing.enforceOn 未含 commit，跳过');
  }

  const stagedFiles = getScopedStagedFiles(root);
  if (stagedFiles.length === 0) {
    return formatResult('test-file-pairing', DECISION.SKIP, '无暂存文件，跳过测试配对');
  }

  const sourceFiles = stagedFiles.filter((f) => isSourceFile(f, config.sourceGlobs, config.exclude));
  if (sourceFiles.length === 0) {
    return formatResult('test-file-pairing', DECISION.SKIP, '暂存区无源码文件，跳过测试配对');
  }

  const unpaired: string[] = [];
  for (const file of sourceFiles) {
    if (!hasPairedTest(file, stagedFiles, root)) {
      unpaired.push(file);
    }
  }

  if (unpaired.length > 0) {
    const sample = unpaired.slice(0, 3).join(', ');
    const suffix = unpaired.length > 3 ? ` 等 ${String(unpaired.length)} 个文件` : '';
    return formatResult(
      'test-file-pairing',
      DECISION.DENY,
      `源码变更缺少测试文件：${sample}${suffix} 无配对 *.test.ts / *_test.py / *.bats`,
    );
  }

  return formatResult('test-file-pairing', DECISION.ALLOW, `源码测试配对通过（${String(sourceFiles.length)} 个文件）`);
}
