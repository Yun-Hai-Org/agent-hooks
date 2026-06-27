import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError, getBunxInvocation } from './tools.js';
import { isHooksProject } from './hooks-project.js';
import { getStagedFiles } from './git-policy.js';
import { resolveTrivyScanners } from './file-patterns.js';
import type { CheckResult } from '../types.js';

const TRIVY_EXTRA_SKIP_DIRS = ['_bmad', '_bmad-output', 'node_modules', '.venv', '.claude/worktrees'];
const TRIVY_TIMEOUT_MS = 360000;
const KNIP_TIMEOUT_MS = 60000;
// trivy 漏洞库下载源：国内镜像（南大）为主选放最前，官方源在后做 fallback（5xx/429 时按序回退）。
// 注意：设置 --db-repository 会覆盖默认源，故须显式保留官方源以维持回退能力。
const TRIVY_DB_REPOS = [
  'ghcr.nju.edu.cn/aquasecurity/trivy-db:2',
  'mirror.gcr.io/aquasec/trivy-db:2',
  'ghcr.io/aquasecurity/trivy-db:2',
];
const TRIVY_DB_REPO_FLAGS = TRIVY_DB_REPOS.map((r) => `--db-repository ${r}`).join(' ');

function getGitleaksConfigArg(cwd?: string): string {
  return execCommand('test -f .gitleaks.toml', { cwd }).success ? ' --config .gitleaks.toml' : '';
}

function buildTrivySkipArgs(ignoredDirs: string[]): string {
  const dirs = [...new Set([...ignoredDirs, ...TRIVY_EXTRA_SKIP_DIRS])];
  return dirs.map((d) => `--skip-dirs "${d}"`).join(' ');
}

export function getGitIgnoredDirs(cwd?: string): string[] {
  const result = execCommand('git ls-files --others --ignored --exclude-standard --directory | head -20', {
    cwd,
    timeout: 5000,
  });
  if (!result.success || !result.stdout.trim()) return [];
  return result.stdout
    .trim()
    .split('\n')
    .map((d) => d.replace(/\/$/, ''));
}

interface SemgrepResult {
  extra?: { severity?: string };
}

interface TrivyVulnerability {
  Severity?: string;
}

interface TrivyLicense {
  Severity?: string;
  Name?: string;
  PkgName?: string;
}

interface TrivyResultEntry {
  Vulnerabilities?: TrivyVulnerability[];
  Licenses?: TrivyLicense[];
}

function isBlockingSeverity(severity?: string): boolean {
  return severity === 'CRITICAL' || severity === 'HIGH' || severity === 'MEDIUM';
}

export function evaluateTrivyJson(stdout: string): CheckResult {
  let json: { Results?: TrivyResultEntry[] };
  try {
    json = JSON.parse(stdout) as { Results?: TrivyResultEntry[] };
  } catch {
    return formatResult('trivy', DECISION.DENY, 'Trivy 输出无法解析，按失败处理（fail-closed）', {
      output: stdout.slice(0, 500),
    });
  }
  const results = json.Results ?? [];
  const vulns = results.flatMap((r) => r.Vulnerabilities ?? []);
  const critical = vulns.filter((v) => v.Severity === 'CRITICAL').length;
  const high = vulns.filter((v) => v.Severity === 'HIGH').length;
  const medium = vulns.filter((v) => v.Severity === 'MEDIUM').length;
  const licenses = results.flatMap((r) => r.Licenses ?? []).filter((l) => isBlockingSeverity(l.Severity));

  if (critical + high + medium > 0 || licenses.length > 0) {
    const parts: string[] = [];
    if (critical + high + medium > 0) {
      parts.push(`${String(critical)} CRITICAL, ${String(high)} HIGH, ${String(medium)} MEDIUM 漏洞`);
    }
    if (licenses.length > 0) {
      parts.push(`${String(licenses.length)} 个不合规 license`);
    }
    return formatResult('trivy', DECISION.DENY, `Trivy 发现 ${parts.join('；')}`, {
      critical,
      high,
      medium,
      licenses: licenses.slice(0, 10).map((l) => `${l.PkgName ?? '?'}:${l.Name ?? '?'}(${l.Severity ?? '?'})`),
    });
  }
  return formatResult('trivy', DECISION.ALLOW, 'Trivy 扫描通过');
}

const CODE_FILE_PATTERN =
  /\.(js|ts|jsx|tsx|mjs|cjs|py|go|java|rb|php|rs|swift|kt|scala|cs|cpp|c|h|yaml|yml|json|toml|sh|bash|zsh)$/i;

/** dataset / iterate_state 等数据 JSON 不做 semgrep（避免大文件或冷启动超时） */
const SEMGREP_SKIP_JSON_PATH =
  /(^|\/)(dataset|data|fixtures|iterate_state|__snapshots__|_bmad-output|node_modules)(\/|$)/i;

export function isSemgrepStagedTarget(filePath: string): boolean {
  if (!CODE_FILE_PATTERN.test(filePath) || filePath.includes('__tests__')) return false;
  if (/\.json$/i.test(filePath) && SEMGREP_SKIP_JSON_PATH.test(filePath)) return false;
  return true;
}

const SEMGREP_CONFIGS = '--config auto --config p/security-audit --config p/secrets --config p/owasp-top-ten';
const SEMGREP_SEVERITY = '--severity ERROR --severity WARNING --severity INFO';
// 全部规则保持全局强制。原先全局停用的 child_process / path-join-traversal 两条规则，
// 已改为在确属受信的调用点用行内 `// nosemgrep: <rule-id>` 精确豁免，避免全局停用掩盖真实风险。
const SEMGREP_EXCLUDED_RULES: string[] = [];
const SEMGREP_EXCLUDE_RULE_FLAGS = SEMGREP_EXCLUDED_RULES.map((r) => `--exclude-rule ${r}`).join(' ');
const SEMGREP_STAGED_TIMEOUT_MS = 60000;
// 全量扫描需遍历全仓库且与 trivy/全量测试等重负载并行，60s 在满载下不足，给 180s 余量。
const SEMGREP_FULL_TIMEOUT_MS = 180000;

export function evaluateSemgrepOutput(stdout: string, checkId: string): CheckResult | null {
  let json: { results?: SemgrepResult[] };
  try {
    json = JSON.parse(stdout) as { results?: SemgrepResult[] };
  } catch {
    return formatResult(checkId, DECISION.DENY, 'Semgrep 输出无法解析，按失败处理（fail-closed）', {
      output: stdout.slice(0, 500),
    });
  }
  const blocking = json.results?.filter((r) => r.extra?.severity === 'ERROR' || r.extra?.severity === 'WARNING') ?? [];
  if (blocking.length === 0) return null;
  const errors = blocking.filter((r) => r.extra?.severity === 'ERROR');
  const warnings = blocking.filter((r) => r.extra?.severity === 'WARNING');
  return formatResult(
    checkId,
    DECISION.DENY,
    `Semgrep 发现 ${String(errors.length)} ERROR, ${String(warnings.length)} WARNING`,
    { count: blocking.length, errors: errors.length, warnings: warnings.length },
  );
}

export async function runSemgrepStaged(cwd?: string): Promise<CheckResult> {
  const stagedFiles = getStagedFiles(cwd).filter((f) => isSemgrepStagedTarget(f));
  if (stagedFiles.length === 0) {
    return formatResult('semgrep-staged', DECISION.SKIP, '暂存区无（非测试）代码文件，跳过 semgrep');
  }

  const missing = denyIfToolMissing('semgrep', 'semgrep-staged', cwd);
  if (missing) return missing;

  const files = stagedFiles.map((f) => `"${f}"`).join(' ');
  const semgrepCmd = `semgrep ${SEMGREP_CONFIGS} ${SEMGREP_SEVERITY} ${SEMGREP_EXCLUDE_RULE_FLAGS} --error --json ${files}`;

  try {
    const result = await withTimeout(
      execCommandAsync(semgrepCmd, { cwd, timeout: SEMGREP_STAGED_TIMEOUT_MS }),
      SEMGREP_STAGED_TIMEOUT_MS,
      'semgrep staged 超时 (60s)',
    );
    if (result.stdout) {
      const deny = evaluateSemgrepOutput(result.stdout, 'semgrep-staged');
      if (deny) return deny;
      return formatResult('semgrep-staged', DECISION.ALLOW, 'Semgrep 暂存文件扫描通过（无 ERROR/WARNING）');
    }
    if (!result.success) {
      return formatResult('semgrep-staged', DECISION.DENY, 'Semgrep 执行失败且无输出，按失败处理（fail-closed）', {
        output: result.stderr.slice(0, 500),
      });
    }
    return formatResult('semgrep-staged', DECISION.ALLOW, 'Semgrep 暂存文件扫描通过');
  } catch (e) {
    return denyOnToolError(e, 'semgrep-staged', 'semgrep');
  }
}

export async function runSemgrep(cwd?: string): Promise<CheckResult> {
  const missing = denyIfToolMissing('semgrep', 'semgrep', cwd);
  if (missing) return missing;
  try {
    const ignoredDirs = getGitIgnoredDirs(cwd);
    const excludeFlags = ignoredDirs.map((d) => `--exclude "${d}"`).join(' ');
    const semgrepCmd = `semgrep ${SEMGREP_CONFIGS} ${SEMGREP_SEVERITY} ${SEMGREP_EXCLUDE_RULE_FLAGS} --error --json --exclude __tests__ ${excludeFlags} .`;
    const result = await withTimeout(
      execCommandAsync(semgrepCmd, { cwd, timeout: SEMGREP_FULL_TIMEOUT_MS }),
      SEMGREP_FULL_TIMEOUT_MS,
      'semgrep 超时 (180s)',
    );
    if (result.stdout) {
      const deny = evaluateSemgrepOutput(result.stdout, 'semgrep');
      if (deny) return deny;
      return formatResult('semgrep', DECISION.ALLOW, 'Semgrep 扫描通过（无 ERROR/WARNING）');
    }
    if (!result.success) {
      return formatResult('semgrep', DECISION.DENY, 'Semgrep 执行失败且无输出，按失败处理（fail-closed）', {
        output: result.stderr.slice(0, 500),
      });
    }
    return formatResult('semgrep', DECISION.ALLOW, 'Semgrep 扫描通过');
  } catch (e) {
    return denyOnToolError(e, 'semgrep', 'semgrep');
  }
}

export async function runKnip(cwd?: string): Promise<CheckResult> {
  if (!isHooksProject(cwd)) {
    return formatResult('knip', DECISION.SKIP, '非 hooks 项目，跳过 knip');
  }

  const missing = denyIfToolMissing('bun', 'knip', cwd);
  if (missing) return missing;
  try {
    const result = await withTimeout(
      execCommandAsync(`${getBunxInvocation(cwd)} knip --reporter json`, { cwd, timeout: KNIP_TIMEOUT_MS }),
      KNIP_TIMEOUT_MS,
      `knip 超时 (${String(KNIP_TIMEOUT_MS / 1000)}s)`,
    );
    if (!result.success) {
      try {
        const json = JSON.parse(result.stdout) as {
          files?: Record<string, unknown>;
          dependencies?: Record<string, unknown>;
        };
        const unusedFiles = json.files ? Object.keys(json.files).length : 0;
        const unusedDeps = json.dependencies ? Object.keys(json.dependencies).length : 0;
        if (unusedFiles > 0 || unusedDeps > 0) {
          return formatResult(
            'knip',
            DECISION.DENY,
            `Knip 发现 ${String(unusedFiles)} 个未使用文件, ${String(unusedDeps)} 个未使用依赖`,
            {
              unusedFiles,
              unusedDeps,
            },
          );
        }
      } catch {
        return formatResult('knip', DECISION.DENY, 'Knip 检查失败', {
          output: (result.stderr || result.stdout).slice(0, 500),
        });
      }
    }
    return formatResult('knip', DECISION.ALLOW, 'Knip 检查通过（无未使用代码）');
  } catch (e) {
    return denyOnToolError(e, 'knip', 'knip');
  }
}

export async function runTrivy(cwd?: string): Promise<CheckResult> {
  const missing = denyIfToolMissing('trivy', 'trivy', cwd);
  if (missing) return missing;
  try {
    const trivyBinResult = execCommand('command -v trivy', { cwd, timeout: 5000 });
    const trivyBin = trivyBinResult.stdout.trim();
    if (!trivyBin) {
      return formatResult('trivy', DECISION.DENY, 'Trivy 未安装或不在 PATH 中', {});
    }

    const scanners = resolveTrivyScanners(cwd);
    const skipCheckUpdate = scanners.includes('misconfig') ? '' : '--skip-check-update';
    const ignoredDirs = getGitIgnoredDirs(cwd);
    const skipDirs = buildTrivySkipArgs(ignoredDirs);
    const trivyCmd =
      `"${trivyBin}" fs ${TRIVY_DB_REPO_FLAGS} --scanners ${scanners} --severity CRITICAL,HIGH,MEDIUM --format json ${skipCheckUpdate} ${skipDirs} .`.replace(
        /\s+/g,
        ' ',
      );
    const result = await withTimeout(
      execCommandAsync(trivyCmd, { cwd, timeout: TRIVY_TIMEOUT_MS }),
      TRIVY_TIMEOUT_MS,
      `trivy 超时 (${String(TRIVY_TIMEOUT_MS / 1000)}s)`,
    );
    if (result.stdout) {
      return evaluateTrivyJson(result.stdout);
    }
    if (!result.success) {
      return formatResult('trivy', DECISION.DENY, 'Trivy 执行失败且无输出，按失败处理（fail-closed）', {
        output: result.stderr.slice(0, 500),
      });
    }
    return formatResult('trivy', DECISION.ALLOW, 'Trivy 扫描通过');
  } catch (e) {
    return denyOnToolError(e, 'trivy', 'trivy');
  }
}

export async function runGitleaksStaged(cwd?: string): Promise<CheckResult> {
  const missing = denyIfToolMissing('gitleaks', 'gitleaks-staged', cwd);
  if (missing) return missing;
  const configArg = getGitleaksConfigArg(cwd);
  try {
    const result = await withTimeout(
      execCommandAsync(`gitleaks protect --staged --no-banner --redact${configArg}`, { cwd, timeout: 30000 }),
      30000,
      'gitleaks staged 超时 (30s)',
    );
    if (!result.success && (result.stderr || result.stdout)) {
      return formatResult('gitleaks-staged', DECISION.DENY, 'gitleaks 在暂存 diff 中发现潜在密钥泄露', {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }
    return formatResult('gitleaks-staged', DECISION.ALLOW, 'gitleaks 暂存 diff 扫描通过');
  } catch (e) {
    return denyOnToolError(e, 'gitleaks-staged', 'gitleaks');
  }
}

export async function runGitleaks(cwd?: string): Promise<CheckResult> {
  const missing = denyIfToolMissing('gitleaks', 'gitleaks', cwd);
  if (missing) return missing;
  const configArg = getGitleaksConfigArg(cwd);
  try {
    const result = await withTimeout(
      execCommandAsync(`gitleaks detect --source . --no-banner --redact${configArg}`, { cwd, timeout: 60000 }),
      60000,
      'gitleaks 超时 (60s)',
    );
    if (!result.success && (result.stderr || result.stdout)) {
      return formatResult('gitleaks', DECISION.DENY, 'gitleaks 发现潜在密钥泄露', {
        output: (result.stderr || result.stdout).slice(0, 500),
      });
    }
    return formatResult('gitleaks', DECISION.ALLOW, 'gitleaks 扫描通过');
  } catch (e) {
    return denyOnToolError(e, 'gitleaks', 'gitleaks');
  }
}
