import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import { getStagedFiles } from './git-policy.js';
import type { CheckResult } from '../types.js';

const TRIVY_EXTRA_SKIP_DIRS = ['_bmad', '_bmad-output', 'node_modules', '.venv', '.claude/worktrees'];
const TRIVY_TIMEOUT_MS = 300000;

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

const CODE_FILE_PATTERN =
  /\.(js|ts|jsx|tsx|mjs|cjs|py|go|java|rb|php|rs|swift|kt|scala|cs|cpp|c|h|yaml|yml|json|toml|sh|bash|zsh)$/i;

const SEMGREP_CONFIGS = '--config auto --config p/security-audit --config p/secrets --config p/owasp-top-ten';
const SEMGREP_SEVERITY = '--severity ERROR --severity WARNING --severity INFO';
// 领域结构性误报规则：本仓库是本地 git hook CLI，核心职责即执行 git/lint 命令并基于受信 cwd 解析路径，
// 故停用 child_process / path-join-traversal 两条规则；其余 secrets/owasp/injection 规则保持强制。
const SEMGREP_EXCLUDED_RULES = [
  'javascript.lang.security.detect-child-process.detect-child-process',
  'javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal',
];
const SEMGREP_EXCLUDE_RULE_FLAGS = SEMGREP_EXCLUDED_RULES.map((r) => `--exclude-rule ${r}`).join(' ');

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
  const stagedFiles = getStagedFiles(cwd).filter((f) => CODE_FILE_PATTERN.test(f) && !f.includes('__tests__'));
  if (stagedFiles.length === 0) {
    return formatResult('semgrep-staged', DECISION.SKIP, '暂存区无（非测试）代码文件，跳过 semgrep');
  }

  const missing = denyIfToolMissing('semgrep', 'semgrep-staged', cwd);
  if (missing) return missing;

  const files = stagedFiles.map((f) => `"${f}"`).join(' ');
  const semgrepCmd = `semgrep ${SEMGREP_CONFIGS} ${SEMGREP_SEVERITY} ${SEMGREP_EXCLUDE_RULE_FLAGS} --error --json ${files}`;

  try {
    const result = await withTimeout(
      execCommandAsync(semgrepCmd, { cwd, timeout: 60000 }),
      60000,
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
      execCommandAsync(semgrepCmd, { cwd, timeout: 60000 }),
      60000,
      'semgrep 超时 (60s)',
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
  const missing = denyIfToolMissing('bun', 'knip', cwd);
  if (missing) return missing;
  try {
    const result = await withTimeout(
      execCommandAsync('bunx knip --reporter json', { cwd, timeout: 30000 }),
      30000,
      'knip 超时 (30s)',
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
    const ignoredDirs = getGitIgnoredDirs(cwd);
    const skipDirs = buildTrivySkipArgs(ignoredDirs);
    const trivyCmd = `trivy fs --scanners vuln,misconfig,secret,license --severity CRITICAL,HIGH,MEDIUM --format json ${skipDirs} .`;
    const result = await withTimeout(
      execCommandAsync(trivyCmd, { cwd, timeout: TRIVY_TIMEOUT_MS }),
      TRIVY_TIMEOUT_MS,
      `trivy 超时 (${String(TRIVY_TIMEOUT_MS / 1000)}s)`,
    );
    if (result.stdout) {
      let json: { Results?: { Vulnerabilities?: TrivyVulnerability[] }[] };
      try {
        json = JSON.parse(result.stdout) as { Results?: { Vulnerabilities?: TrivyVulnerability[] }[] };
      } catch {
        return formatResult('trivy', DECISION.DENY, 'Trivy 输出无法解析，按失败处理（fail-closed）', {
          output: result.stdout.slice(0, 500),
        });
      }
      const vulns = json.Results?.flatMap((r) => r.Vulnerabilities ?? []) ?? [];
      const criticals = vulns.filter((v) => v.Severity === 'CRITICAL');
      const highs = vulns.filter((v) => v.Severity === 'HIGH');
      const mediums = vulns.filter((v) => v.Severity === 'MEDIUM');
      if (criticals.length > 0 || highs.length > 0 || mediums.length > 0) {
        return formatResult(
          'trivy',
          DECISION.DENY,
          `Trivy 发现 ${String(criticals.length)} CRITICAL, ${String(highs.length)} HIGH, ${String(mediums.length)} MEDIUM 漏洞`,
          { critical: criticals.length, high: highs.length, medium: mediums.length },
        );
      }
      return formatResult('trivy', DECISION.ALLOW, 'Trivy 扫描通过');
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
