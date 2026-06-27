import { basename, extname, join } from 'path';
import { readFileSync } from 'fs';
import { execCommand } from '../security-orchestrator.js';

const K8S_DIR_PREFIX = /^(k8s|kubernetes|manifests|deploy)\//i;
const K8S_HELM_TEMPLATES = /^charts\/templates\//i;
const K8S_RESOURCE_FILENAME =
  /^(deployment|service|ingress|configmap|secret|pod|statefulset|daemonset|job|cronjob|namespace|persistentvolumeclaim|hpa|networkpolicy)(\.ya?ml)?$/i;

const OPENAPI_FILENAME = /^(openapi|swagger)\.(ya?ml|json)$/i;
const OPENAPI_DIR = /(^|\/)(openapi|api-docs)\//i;

export function isOpenApiSpecExcludedPath(filePath: string): boolean {
  if (filePath.startsWith('_bmad-output/') || filePath.startsWith('_bmad/')) return true;
  if (/\.github\/workflows\//i.test(filePath)) return true;
  return false;
}

export function isOpenApiSpecCandidatePath(filePath: string): boolean {
  if (isOpenApiSpecExcludedPath(filePath)) return false;
  if (OPENAPI_FILENAME.test(basename(filePath))) return true;
  if (OPENAPI_DIR.test(filePath) && /\.(ya?ml|json)$/i.test(filePath)) return true;
  return false;
}

export function looksLikeOpenApiSpecContent(content: string): boolean {
  return /openapi:\s*['"]?3/i.test(content);
}

export function isOpenApiSpecPath(filePath: string, cwd?: string): boolean {
  if (!isOpenApiSpecCandidatePath(filePath)) return false;
  if (OPENAPI_FILENAME.test(basename(filePath)) || OPENAPI_DIR.test(filePath)) return true;
  if (!cwd) return false;
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 受信，filePath 为待检测的暂存文件路径，仅读取首 4KB 做类型判定
    const content = readFileSync(join(cwd, filePath), 'utf-8').slice(0, 4096);
    return looksLikeOpenApiSpecContent(content);
  } catch {
    return false;
  }
}

export function isDockerfilePath(filePath: string): boolean {
  const filename = basename(filePath).toLowerCase();
  const ext = extname(filePath).toLowerCase();
  return ext === '.dockerfile' || filename === 'dockerfile' || filename === 'containerfile';
}

export function isDockerComposePath(filePath: string): boolean {
  const filename = basename(filePath).toLowerCase();
  if (filename.includes('override')) return false;
  if (/^docker-compose\..+\.ya?ml$/.test(filename)) return true;
  return (
    filename === 'docker-compose.yml' ||
    filename === 'docker-compose.yaml' ||
    filename === 'compose.yml' ||
    filename === 'compose.yaml'
  );
}

export function isK8sManifestExcludedPath(filePath: string): boolean {
  if (isDockerComposePath(filePath)) return true;
  if (/docker-compose/i.test(filePath)) return true;
  if (/\.github\/workflows\//i.test(filePath)) return true;
  if (/\/Chart\.ya?ml$/i.test(filePath) || /\/values\.ya?ml$/i.test(filePath)) return true;
  return false;
}

export function isK8sManifestCandidatePath(filePath: string): boolean {
  if (!/\.(yaml|yml)$/i.test(filePath)) return false;
  if (isK8sManifestExcludedPath(filePath)) return false;
  if (K8S_DIR_PREFIX.test(filePath) || K8S_HELM_TEMPLATES.test(filePath)) return true;
  return K8S_RESOURCE_FILENAME.test(basename(filePath));
}

export function looksLikeK8sManifestContent(content: string): boolean {
  return /^apiVersion:\s*\S+/m.test(content) && /^kind:\s*\S+/m.test(content);
}

export function isK8sManifestPath(filePath: string, cwd?: string): boolean {
  if (!isK8sManifestCandidatePath(filePath)) return false;
  if (K8S_DIR_PREFIX.test(filePath) || K8S_HELM_TEMPLATES.test(filePath)) return true;
  if (K8S_RESOURCE_FILENAME.test(basename(filePath))) return true;
  if (!cwd) return false;
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 受信，filePath 为待检测的暂存文件路径，仅读取首 4KB 做类型判定
    const content = readFileSync(join(cwd, filePath), 'utf-8').slice(0, 4096);
    return looksLikeK8sManifestContent(content);
  } catch {
    return false;
  }
}

export function classifyFiles(files: string[], cwd?: string) {
  const md = files.filter((f) => /\.(md|mdx)$/i.test(f));
  const shell = files.filter((f) => /\.(sh|bash|zsh)$/i.test(f));
  const docker = files.filter((f) => isDockerfilePath(f));
  const compose = files.filter((f) => isDockerComposePath(f));
  const k8s = files.filter((f) => isK8sManifestPath(f, cwd));
  const toml = files.filter((f) => f.endsWith('.toml'));
  const sql = files.filter((f) => f.endsWith('.sql'));
  const css = files.filter((f) => /\.(css|scss|less)$/i.test(f));
  const json = files.filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'));
  const yaml = files.filter((f) => /\.(yaml|yml)$/i.test(f) && !isDockerComposePath(f));
  return { md, shell, docker, compose, k8s, toml, sql, css, json, yaml };
}

export function listTrackedFiles(predicate: (file: string) => boolean, cwd?: string): string[] {
  const result = execCommand('git ls-files', { cwd });
  if (!result.success) return [];
  return result.stdout.trim().split('\n').filter(Boolean).filter(predicate);
}

export function hasTrivyMisconfigTargets(cwd?: string): boolean {
  return (
    listTrackedFiles((f) => {
      if (isDockerfilePath(f)) return true;
      if (isDockerComposePath(f)) return true;
      if (isK8sManifestCandidatePath(f)) return true;
      if (/\.tf$/i.test(f)) return true;
      return false;
    }, cwd).length > 0
  );
}

export function resolveTrivyScanners(cwd?: string): string {
  return hasTrivyMisconfigTargets(cwd) ? 'vuln,misconfig,secret,license' : 'vuln,secret,license';
}

export function hasStylelintConfig(cwd?: string): boolean {
  return (
    execCommand('test -f .stylelintrc.json', { cwd }).success ||
    execCommand('test -f .stylelintrc.js', { cwd }).success ||
    execCommand('test -f .stylelintrc', { cwd }).success ||
    execCommand('test -f stylelint.config.js', { cwd }).success ||
    execCommand('test -f .stylelintrc.yml', { cwd }).success
  );
}
