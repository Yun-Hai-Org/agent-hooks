import { basename, extname, join } from 'path';
import { readFileSync } from 'fs';
import { execCommand } from '../security-orchestrator.js';

const K8S_DIR_PREFIX = /^(k8s|kubernetes|manifests|deploy)\//i;
const K8S_HELM_TEMPLATES = /^charts\/templates\//i;
const K8S_RESOURCE_FILENAME =
  /^(deployment|service|ingress|configmap|secret|pod|statefulset|daemonset|job|cronjob|namespace|persistentvolumeclaim|hpa|networkpolicy)(\.ya?ml)?$/i;

const OPENAPI_FILENAME = /^(openapi|swagger)\.(ya?ml|json)$/i;
const OPENAPI_DIR = /(^|\/)(openapi|api-docs)\//i;

/** @param {string} filePath */
export function isOpenApiSpecExcludedPath(filePath) {
  if (filePath.startsWith('_bmad-output/') || filePath.startsWith('_bmad/')) return true;
  if (/\.github\/workflows\//i.test(filePath)) return true;
  return false;
}

/** @param {string} filePath */
export function isOpenApiSpecCandidatePath(filePath) {
  if (isOpenApiSpecExcludedPath(filePath)) return false;
  if (OPENAPI_FILENAME.test(basename(filePath))) return true;
  if (OPENAPI_DIR.test(filePath) && /\.(ya?ml|json)$/i.test(filePath)) return true;
  return false;
}

/** @param {string} content */
export function looksLikeOpenApiSpecContent(content) {
  return /openapi:\s*['"]?3/i.test(content);
}

/**
 * @param {string} filePath
 * @param {string} [cwd]
 */
export function isOpenApiSpecPath(filePath, cwd) {
  if (!isOpenApiSpecCandidatePath(filePath)) return false;
  if (OPENAPI_FILENAME.test(basename(filePath)) || OPENAPI_DIR.test(filePath)) return true;
  if (!cwd) return false;
  try {
    const content = readFileSync(join(cwd, filePath), 'utf-8').slice(0, 4096);
    return looksLikeOpenApiSpecContent(content);
  } catch {
    return false;
  }
}

/** @param {string} filePath */
export function isDockerfilePath(filePath) {
  const filename = basename(filePath).toLowerCase();
  const ext = extname(filePath).toLowerCase();
  return ext === '.dockerfile' || filename === 'dockerfile' || filename === 'containerfile';
}

/** @param {string} filePath */
export function isDockerComposePath(filePath) {
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

/** @param {string} filePath */
export function isK8sManifestExcludedPath(filePath) {
  if (isDockerComposePath(filePath)) return true;
  if (/docker-compose/i.test(filePath)) return true;
  if (/\.github\/workflows\//i.test(filePath)) return true;
  if (/\/Chart\.ya?ml$/i.test(filePath) || /\/values\.ya?ml$/i.test(filePath)) return true;
  return false;
}

/** @param {string} filePath */
export function isK8sManifestCandidatePath(filePath) {
  if (!/\.(yaml|yml)$/i.test(filePath)) return false;
  if (isK8sManifestExcludedPath(filePath)) return false;
  if (K8S_DIR_PREFIX.test(filePath) || K8S_HELM_TEMPLATES.test(filePath)) return true;
  return K8S_RESOURCE_FILENAME.test(basename(filePath));
}

/** @param {string} content */
export function looksLikeK8sManifestContent(content) {
  return /^apiVersion:\s*\S+/m.test(content) && /^kind:\s*\S+/m.test(content);
}

/**
 * @param {string} filePath
 * @param {string} [cwd]
 */
export function isK8sManifestPath(filePath, cwd) {
  if (!isK8sManifestCandidatePath(filePath)) return false;
  if (K8S_DIR_PREFIX.test(filePath) || K8S_HELM_TEMPLATES.test(filePath)) return true;
  if (K8S_RESOURCE_FILENAME.test(basename(filePath))) return true;
  if (!cwd) return false;
  try {
    const content = readFileSync(join(cwd, filePath), 'utf-8').slice(0, 4096);
    return looksLikeK8sManifestContent(content);
  } catch {
    return false;
  }
}

/**
 * @param {string[]} files
 * @param {string} [cwd]
 */
export function classifyFiles(files, cwd) {
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

/**
 * @param {(file: string) => boolean} predicate
 * @param {string} [cwd]
 */
export function listTrackedFiles(predicate, cwd) {
  const result = execCommand('git ls-files', { cwd });
  if (!result.success) return [];
  return result.stdout.trim().split('\n').filter(Boolean).filter(predicate);
}

/** @param {string} [cwd] */
export function hasStylelintConfig(cwd) {
  return (
    execCommand('test -f .stylelintrc.json', { cwd }).success ||
    execCommand('test -f .stylelintrc.js', { cwd }).success ||
    execCommand('test -f .stylelintrc', { cwd }).success ||
    execCommand('test -f stylelint.config.js', { cwd }).success ||
    execCommand('test -f .stylelintrc.yml', { cwd }).success
  );
}
