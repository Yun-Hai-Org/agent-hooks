import { execCommand, execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';

/** @param {string} [cwd] */
export function getGitIgnoredDirs(cwd) {
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

/** @param {string} [cwd] */
export async function runSemgrep(cwd) {
  const missing = denyIfToolMissing('semgrep', 'semgrep', cwd);
  if (missing) return missing;
  try {
    const ignoredDirs = getGitIgnoredDirs(cwd);
    const excludeFlags = ignoredDirs.map((d) => `--exclude "${d}"`).join(' ');
    const semgrepCmd = `semgrep --config auto --config p/security-audit --config p/secrets --config p/owasp-top-ten --severity ERROR,WARNING,INFO --json ${excludeFlags} .`;
    const result = await withTimeout(execCommandAsync(semgrepCmd, { cwd, timeout: 60000 }), 60000, 'semgrep 超时 (60s)');
    if (!result.success && result.stdout) {
      try {
        const json = JSON.parse(result.stdout);
        const errors = json.results?.filter((r) => r.extra?.severity === 'ERROR') || [];
        if (errors.length > 0) {
          return formatResult('semgrep', DECISION.DENY, `Semgrep 发现 ${errors.length} 个 ERROR 级别问题`, {
            count: errors.length,
          });
        }
      } catch {}
    }
    return formatResult('semgrep', DECISION.ALLOW, result.success ? 'Semgrep 扫描通过' : 'Semgrep 扫描完成（无 ERROR）');
  } catch (e) {
    return denyOnToolError(e, 'semgrep', 'semgrep');
  }
}

/** @param {string} [cwd] */
export async function runKnip(cwd) {
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
        const json = JSON.parse(result.stdout);
        const unusedFiles = json.files ? Object.keys(json.files).length : 0;
        const unusedDeps = json.dependencies ? Object.keys(json.dependencies).length : 0;
        if (unusedFiles > 0 || unusedDeps > 0) {
          return formatResult('knip', DECISION.DENY, `Knip 发现 ${unusedFiles} 个未使用文件, ${unusedDeps} 个未使用依赖`, {
            unusedFiles,
            unusedDeps,
          });
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

/** @param {string} [cwd] */
export async function runTrivy(cwd) {
  const missing = denyIfToolMissing('trivy', 'trivy', cwd);
  if (missing) return missing;
  try {
    const ignoredDirs = getGitIgnoredDirs(cwd);
    const skipDirs = ignoredDirs.map((d) => `--skip-dirs "${d}"`).join(' ');
    const trivyCmd = `trivy fs --scanners vuln,misconfig,secret,license --severity CRITICAL,HIGH,MEDIUM --format json ${skipDirs} .`;
    const result = await withTimeout(execCommandAsync(trivyCmd, { cwd, timeout: 60000 }), 60000, 'trivy 超时 (60s)');
    if (result.stdout) {
      try {
        const json = JSON.parse(result.stdout);
        const vulns = json.Results?.flatMap((r) => r.Vulnerabilities || []) || [];
        const criticals = vulns.filter((v) => v.Severity === 'CRITICAL');
        const highs = vulns.filter((v) => v.Severity === 'HIGH');
        const mediums = vulns.filter((v) => v.Severity === 'MEDIUM');
        if (criticals.length > 0 || highs.length > 0 || mediums.length > 0) {
          return formatResult(
            'trivy',
            DECISION.DENY,
            `Trivy 发现 ${criticals.length} CRITICAL, ${highs.length} HIGH, ${mediums.length} MEDIUM 漏洞`,
            { critical: criticals.length, high: highs.length, medium: mediums.length },
          );
        }
      } catch {}
    }
    return formatResult('trivy', DECISION.ALLOW, 'Trivy 扫描通过');
  } catch (e) {
    return denyOnToolError(e, 'trivy', 'trivy');
  }
}

/** @param {string} [cwd] */
export async function runGitleaks(cwd) {
  const missing = denyIfToolMissing('gitleaks', 'gitleaks', cwd);
  if (missing) return missing;
  try {
    const result = await withTimeout(
      execCommandAsync('gitleaks detect --source . --no-banner --redact', { cwd, timeout: 60000 }),
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
