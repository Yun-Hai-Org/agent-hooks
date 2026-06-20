#!/usr/bin/env bun
/**
 * Resolve Hook Path - 钩子路径解析器
 * 支持全局模式：项目级钩子优先，回退到全局 ~/.claude/hooks/
 *
 * 用法: bun .claude/hooks/resolve-hook-path.js <hook-name>.js
 *
 * 解析顺序:
 *   1. 项目级: <cwd>/.claude/hooks/<hook-name>.js
 *   2. 全局级: ~/.claude/hooks/<hook-name>.js
 *
 * 从 settings.json 调用示例:
 *   { "command": "bun .claude/hooks/resolve-hook-path.js block-dangerous-commands.js" }
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

// ─── 常量 ───────────────────────────────────────────────────────────────────

const HOOK_NAME = 'resolve-hook-path';
const PROJECT_HOOKS_DIR = '.claude/hooks';
const GLOBAL_HOOKS_DIR = join(process.env.HOME || '', '.claude', 'hooks');

// ─── 路径解析 ───────────────────────────────────────────────────────────────

/**
 * 解析钩子脚本的绝对路径
 * 项目级优先，回退到全局
 *
 * @param {string} hookFile - 钩子文件名（如 'block-dangerous-commands.js'）
 * @param {string} [cwd] - 工作目录，默认 process.cwd()
 * @returns {{ path: string, source: 'project' | 'global' } | null}
 */
export function resolveHookPath(hookFile, cwd) {
  if (!hookFile || typeof hookFile !== 'string' || !hookFile.trim()) return null;
  const workingDir = cwd || process.cwd();

  // 1. 项目级优先
  const projectPath = resolve(workingDir, PROJECT_HOOKS_DIR, hookFile);
  if (existsSync(projectPath)) {
    return { path: projectPath, source: 'project' };
  }

  // 2. 回退到全局
  const globalPath = resolve(GLOBAL_HOOKS_DIR, hookFile);
  if (existsSync(globalPath)) {
    return { path: globalPath, source: 'global' };
  }

  return null;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const hookFile = process.argv[2];

  if (!hookFile) {
    console.error(`🚫 [${HOOK_NAME}] 用法: bun resolve-hook-path.js <hook-name>.js`);
    console.log('{}');
    process.exit(0);
  }

  const resolved = resolveHookPath(hookFile);

  if (!resolved) {
    console.error(`🚫 [${HOOK_NAME}] 未找到钩子: ${hookFile}`);
    console.error(`  项目级: ${resolve(process.cwd(), PROJECT_HOOKS_DIR, hookFile)}`);
    console.error(`  全局级: ${resolve(GLOBAL_HOOKS_DIR, hookFile)}`);
    console.log('{}');
    process.exit(0);
  }

  // 使用 bun 执行解析后的钩子脚本，传递 stdin
  const result = spawnSync('bun', [resolved.path], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: process.env,
  });

  process.exit(result.status ?? 0);
}

// 只在直接运行时执行 main()，导入时不执行
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { PROJECT_HOOKS_DIR, GLOBAL_HOOKS_DIR };
