import { basename, extname } from 'path';
import { execCommand } from '../security-orchestrator.js';

/** @param {string} filePath */
export function isDockerfilePath(filePath) {
  const filename = basename(filePath).toLowerCase();
  const ext = extname(filePath).toLowerCase();
  return ext === '.dockerfile' || filename === 'dockerfile' || filename === 'containerfile';
}

/**
 * @param {string[]} files
 */
export function classifyFiles(files) {
  const md = files.filter((f) => /\.(md|mdx)$/i.test(f));
  const shell = files.filter((f) => /\.(sh|bash|zsh)$/i.test(f));
  const docker = files.filter((f) => isDockerfilePath(f));
  const toml = files.filter((f) => f.endsWith('.toml'));
  const sql = files.filter((f) => f.endsWith('.sql'));
  const css = files.filter((f) => /\.(css|scss|less)$/i.test(f));
  const json = files.filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'));
  const yaml = files.filter((f) => /\.(yaml|yml)$/i.test(f));
  return { md, shell, docker, toml, sql, css, json, yaml };
}

/**
 * @param {string} [cwd]
 * @param {(file: string) => boolean} predicate
 */
export function listTrackedFiles(cwd, predicate) {
  const result = execCommand('git ls-files', { cwd });
  if (!result.success) return [];
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(predicate);
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
