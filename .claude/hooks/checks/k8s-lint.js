import { execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { isK8sManifestPath, listTrackedFiles } from './file-patterns.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';

const KUBECONFORM_TIMEOUT_MS = 30000;
const KUBE_LINTER_TIMEOUT_MS = 60000;

/**
 * @param {string} output
 */
export function parseKubeconformSummary(output) {
  try {
    const json = JSON.parse(output);
    const summary = json.summary ?? json;
    const invalid = summary.resources_invalid ?? summary.invalid ?? 0;
    const valid = summary.resources_valid ?? summary.valid ?? 0;
    const total = summary.resources_scanned ?? summary.total ?? invalid + valid;
    return { invalid, valid, total };
  } catch {
    return null;
  }
}

/**
 * @param {string} output
 */
export function parseKubeLinterDiagnostics(output) {
  try {
    const json = JSON.parse(output);
    const reports = json.reports ?? [];
    const diagnostics = reports.flatMap(
      (/** @type {{ diagnostics?: Array<{ severity?: string; check?: string; message?: string }> }} */ r) =>
        r.diagnostics ?? [],
    );
    const errors = diagnostics.filter(
      (/** @type {{ severity?: string }} */ d) => String(d.severity).toLowerCase() === 'error',
    );
    const warnings = diagnostics.filter(
      (/** @type {{ severity?: string }} */ d) => String(d.severity).toLowerCase() === 'warning',
    );
    return { errors, warnings, diagnostics };
  } catch {
    return { errors: [], warnings: [], diagnostics: [] };
  }
}

/** @param {string} output */
function formatKubeLinterDenyOutput(output) {
  const { errors, warnings } = parseKubeLinterDiagnostics(output);
  const lines = [
    ...errors
      .slice(0, 10)
      .map(
        (/** @type {{ check?: string; message?: string }} */ d) => `[ERROR] ${d.check ?? 'rule'}: ${d.message ?? ''}`,
      ),
    ...warnings
      .slice(0, 5)
      .map(
        (/** @type {{ check?: string; message?: string }} */ d) => `[WARN] ${d.check ?? 'rule'}: ${d.message ?? ''}`,
      ),
  ];
  return lines.length > 0 ? lines.join('\n') : output.slice(0, 500);
}

/**
 * @param {string[]} files
 * @param {string} idPrefix
 * @param {string} [cwd]
 */
async function runK8sChecks(files, idPrefix, cwd) {
  const results = [];

  const kubeconformMissing = denyIfToolMissing('kubeconform', `${idPrefix}-kubeconform`, cwd);
  if (kubeconformMissing) return kubeconformMissing;

  const kubeLinterMissing = denyIfToolMissing('kube-linter', `${idPrefix}-kube-linter`, cwd);
  if (kubeLinterMissing) return kubeLinterMissing;

  for (const file of files) {
    try {
      const kubeconformResult = await withTimeout(
        execCommandAsync(`kubeconform -summary -output json -ignore-missing-schemas "${file}"`, {
          cwd,
          timeout: KUBECONFORM_TIMEOUT_MS,
        }),
        KUBECONFORM_TIMEOUT_MS,
        `kubeconform 超时 (${KUBECONFORM_TIMEOUT_MS / 1000}s): ${file}`,
      );
      const kubeconformOutput = kubeconformResult.stdout || kubeconformResult.stderr;
      const summary = parseKubeconformSummary(kubeconformOutput);
      const kubeconformFailed = !kubeconformResult.success || (summary && summary.invalid > 0);
      results.push(
        kubeconformFailed
          ? formatResult(`${idPrefix}-kubeconform`, DECISION.DENY, `kubeconform 检查失败: ${file}`, {
              output: kubeconformOutput.slice(0, 500),
            })
          : formatResult(`${idPrefix}-kubeconform`, DECISION.ALLOW, `kubeconform 检查通过: ${file}`),
      );
    } catch (e) {
      results.push(denyOnToolError(e, `${idPrefix}-kubeconform`, 'kubeconform'));
    }

    try {
      const kubeLinterResult = await withTimeout(
        execCommandAsync(`kube-linter lint "${file}" --format json`, {
          cwd,
          timeout: KUBE_LINTER_TIMEOUT_MS,
        }),
        KUBE_LINTER_TIMEOUT_MS,
        `kube-linter 超时 (${KUBE_LINTER_TIMEOUT_MS / 1000}s): ${file}`,
      );
      const kubeLinterOutput = kubeLinterResult.stdout || kubeLinterResult.stderr;
      const { errors, warnings } = parseKubeLinterDiagnostics(kubeLinterOutput);
      if (errors.length > 0) {
        results.push(
          formatResult(`${idPrefix}-kube-linter`, DECISION.DENY, `kube-linter 检查失败: ${file}`, {
            output: formatKubeLinterDenyOutput(kubeLinterOutput),
            errorCount: errors.length,
          }),
        );
      } else if (warnings.length > 0) {
        results.push(
          formatResult(
            `${idPrefix}-kube-linter`,
            DECISION.WARN,
            `kube-linter 发现 ${warnings.length} 个 warning: ${file}`,
            {
              output: formatKubeLinterDenyOutput(kubeLinterOutput),
              warningCount: warnings.length,
            },
          ),
        );
      } else {
        results.push(formatResult(`${idPrefix}-kube-linter`, DECISION.ALLOW, `kube-linter 检查通过: ${file}`));
      }
    } catch (e) {
      results.push(denyOnToolError(e, `${idPrefix}-kube-linter`, 'kube-linter'));
    }
  }

  const failure = results.find((r) => r.decision === DECISION.DENY);
  if (failure) return failure;

  const warnings = results.filter((r) => r.decision === DECISION.WARN);
  if (warnings.length > 0) {
    return formatResult(idPrefix, DECISION.WARN, `K8s lint 通过（${warnings.length} 个 warning）`, {
      warnings: warnings.map((w) => w.message),
    });
  }

  return formatResult(idPrefix, DECISION.ALLOW, 'K8s manifest 检查通过');
}

/** @param {string} [cwd] */
export async function runK8sLintStaged(cwd) {
  const staged = getStagedFiles(cwd);
  const k8sFiles = staged.filter((f) => isK8sManifestPath(f, cwd));
  if (k8sFiles.length === 0) {
    return formatResult('k8s-staged', DECISION.SKIP, '暂存区无 K8s manifest，跳过');
  }
  return runK8sChecks(k8sFiles, 'k8s-staged', cwd);
}

/** @param {string} [cwd] */
export async function runK8sLintFull(cwd) {
  const k8sFiles = listTrackedFiles((f) => {
    if (f.startsWith('_bmad-output/') || f.startsWith('_bmad/')) return false;
    return isK8sManifestPath(f, cwd);
  }, cwd);
  if (k8sFiles.length === 0) {
    return formatResult('k8s-full', DECISION.SKIP, '仓库无 K8s manifest，跳过');
  }
  return runK8sChecks(k8sFiles, 'k8s-full', cwd);
}
