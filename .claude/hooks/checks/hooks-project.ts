import { existsSync } from 'fs';
import { join } from 'path';

const HOOKS_PROJECT_MARKER = join('.claude', 'hooks', 'quality-gate.ts');

export function isHooksProject(cwd?: string): boolean {
  const root = cwd ?? process.cwd();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- root 为受信仓库根，第二参为常量 marker 路径
  return existsSync(join(root, HOOKS_PROJECT_MARKER));
}
