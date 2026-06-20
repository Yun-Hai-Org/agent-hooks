#!/usr/bin/env bun
/**
 * SessionStart Health Check - SessionStart Hook
 * 会话启动时检查所有保护工具的可用性
 *
 * 功能：
 * 1. 扫描所有 hook 依赖的外部工具
 * 2. 输出健康检查报告（🟢 可用 / 🔴 不可用）
 * 3. 2 秒超时保护，优雅降级
 * 4. fail-open：永不阻止会话启动
 */

import { execSync } from 'child_process';
import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR } from './security-orchestrator.js';
import { getPlatform } from './hook-adapter.js';
const HOOK_NAME = 'session-start';
const GLOBAL_TIMEOUT_MS = 2000;
const PER_TOOL_TIMEOUT_MS = 500;

/**
 * 日志记录
 * @param {Record<string, unknown>} data
 */
function log(data) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: HOOK_NAME, ...data }) + '\n');
  } catch {}
}

/**
 * 获取工具版本
 * 优先提取包含版本号的行，回退到第一行
 * @param {string} command
 * @returns {string}
 */
function getToolVersion(command) {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: PER_TOOL_TIMEOUT_MS,
    });
    const lines = output.trim().split('\n');
    // 优先找 "version: x.y.z" 格式的行（如 shellcheck）
    const versionLine = lines.find((l) => /^\s*version[:\s]/i.test(l));
    if (versionLine) {
      return versionLine.replace(/^\s*version[:\s]*/i, '').trim();
    }
    // 回退到第一行
    return lines[0];
  } catch {
    return '';
  }
}

/**
 * 检查单个工具可用性
 * @param {string} name - 工具名称
 * @param {string} binary - 可执行文件名
 * @param {string} [versionCmd] - 版本查询命令
 * @returns {{ name: string, available: boolean, version: string }}
 */
function checkTool(name, binary, versionCmd) {
  try {
    execSync(`which ${binary}`, { stdio: 'pipe', timeout: PER_TOOL_TIMEOUT_MS });
    const version = versionCmd ? getToolVersion(versionCmd) : '';
    return { name, available: true, version };
  } catch {
    return { name, available: false, version: '' };
  }
}

/**
 * 所有待检查工具列表
 */
const TOOLS = [
  // 核心运行时（优先检测）
  { name: 'bun', binary: 'bun', versionCmd: 'bun --version' },
  { name: 'uv', binary: 'uv', versionCmd: 'uv --version' },
  { name: 'gitleaks', binary: 'gitleaks', versionCmd: 'gitleaks version' },
  // Shell 工具
  { name: 'shellcheck', binary: 'shellcheck', versionCmd: 'shellcheck --version' },
  { name: 'shfmt', binary: 'shfmt', versionCmd: 'shfmt --version' },
  // Docker 工具
  { name: 'hadolint', binary: 'hadolint', versionCmd: 'hadolint --version' },
  // TOML 工具
  { name: 'taplo', binary: 'taplo', versionCmd: 'taplo --version' },
  // SQL 工具
  { name: 'sqlfluff', binary: 'sqlfluff', versionCmd: 'sqlfluff version' },
  // CSS 工具
  { name: 'stylelint', binary: 'stylelint', versionCmd: 'stylelint --version' },
  // 通用格式化
  { name: 'prettier', binary: 'prettier', versionCmd: 'prettier --version' },
  // JS/TS 工具
  { name: 'eslint', binary: 'eslint', versionCmd: 'eslint --version' },
  // Python 工具
  { name: 'ruff', binary: 'ruff', versionCmd: 'ruff --version' },
  { name: 'pyright', binary: 'pyright', versionCmd: 'pyright --version' },
  // Markdown 工具
  { name: 'markdownlint', binary: 'markdownlint', versionCmd: 'markdownlint --version' },
  // JSON/YAML 工具
  { name: 'jq', binary: 'jq', versionCmd: 'jq --version' },
  { name: 'yq', binary: 'yq', versionCmd: 'yq --version' },
  // Schema 验证
  { name: 'check-jsonschema', binary: 'check-jsonschema', versionCmd: 'check-jsonschema --version' },
  // 安全扫描
  { name: 'semgrep', binary: 'semgrep', versionCmd: 'semgrep --version' },
  { name: 'trivy', binary: 'trivy', versionCmd: 'trivy --version' },
  // 死代码检测
  { name: 'knip', binary: 'knip', versionCmd: 'knip --version' },
  // 包管理器
];

/**
 * 顺序检查所有工具（带全局超时保护）
 * @returns {Promise<Array<{ name: string, available: boolean, version: string }>>}
 */
async function checkAllTools() {
  const results = [];
  const startTime = Date.now();

  for (const tool of TOOLS) {
    // 检查全局超时
    if (Date.now() - startTime > GLOBAL_TIMEOUT_MS) {
      log({ level: 'TIMEOUT', checked: results.length, total: TOOLS.length });
      // 剩余工具标记为超时
      for (let i = results.length; i < TOOLS.length; i++) {
        results.push({ name: TOOLS[i].name, available: false, version: '' });
      }
      break;
    }
    results.push(checkTool(tool.name, tool.binary, tool.versionCmd));
  }

  return results;
}

/**
 * 格式化单个工具状态
 * @param {{ name: string, available: boolean, version: string }} tool
 * @returns {string}
 */
function formatToolStatus(tool) {
  if (tool.available) {
    const versionStr = tool.version ? ` (${tool.version})` : '';
    return `  🟢 ${tool.name} ✔${versionStr}`;
  }
  return `  🔴 ${tool.name} ❌ (未安装)`;
}

/**
 * 生成健康检查报告
 * @param {Array<{ name: string, available: boolean, version: string }>} results
 * @returns {string}
 */
function formatReport(results) {
  const available = results.filter((r) => r.available);
  const unavailable = results.filter((r) => !r.available);
  const total = results.length;
  const okCount = available.length;

  const lines = [`ℹ️ [session-start] 工具健康检查 (${okCount}/${total} 可用)`, ''];

  // 先显示可用工具
  for (const tool of available) {
    lines.push(formatToolStatus(tool));
  }

  // 再显示不可用工具
  if (unavailable.length > 0) {
    lines.push('');
    lines.push('  缺失工具（相关功能将自动跳过）:');
    for (const tool of unavailable) {
      lines.push(formatToolStatus(tool));
    }
  }

  return lines.join('\n');
}

/**
 * 格式化 JSON 结果（供后续 hook 处理）
 * @param {Array<{ name: string, available: boolean, version: string }>} results
 * @returns {string}
 */
function formatJsonResult(results) {
  const summary = {
    total: results.length,
    available: results.filter((r) => r.available).length,
    unavailable: results.filter((r) => !r.available).length,
  };

  const toolStatus = {};
  for (const r of results) {
    toolStatus[r.name] = {
      available: r.available,
      version: r.version || null,
    };
  }

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      report: formatReport(results),
      summary,
      tools: toolStatus,
    },
  });
}

async function main() {
  const startTime = Date.now();

  try {
    const results = await checkAllTools();
    const elapsed = Date.now() - startTime;

    process.stderr.write(formatReport(results) + '\n');
    checkGitHooksPath();

    if (getPlatform() === 'cursor') {
      console.log('{}');
    } else {
      console.log(formatJsonResult(results));
    }

    log({
      level: 'INFO',
      elapsed,
      total: results.length,
      available: results.filter((r) => r.available).length,
      unavailable: results.filter((r) => !r.available).length,
    });
  } catch (/** @type {any} */ error) {
    // 超时或异常时优雅降级
    log({
      level: 'ERROR',
      error: error.message || String(error),
      elapsed: Date.now() - startTime,
    });

    // 输出降级消息
    process.stderr.write(`ℹ️ [session-start] 健康检查超时，部分工具状态未知\n`);
    console.log('{}');
  }
}

function checkGitHooksPath() {
  try {
    const cwd = process.cwd();
    const hooksPath = execSync('git config core.hooksPath', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (hooksPath && hooksPath !== '.githooks') {
      process.stderr.write(`⚠️ [session-start] core.hooksPath=${hooksPath}，建议运行 ./scripts/install-git-hooks.sh\n`);
      log({ level: 'WARN', reason: 'core.hooksPath mismatch', hooksPath });
    } else if (!hooksPath) {
      process.stderr.write(`⚠️ [session-start] 未配置 core.hooksPath，请运行 ./scripts/install-git-hooks.sh\n`);
      log({ level: 'WARN', reason: 'core.hooksPath not set' });
    }
  } catch {
    // 非 git 仓库，跳过
  }
}

// 只在直接运行时执行 main，导入时不执行
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1]);
if (isDirectRun) {
  main();
}

export { checkTool, checkAllTools, formatToolStatus, formatReport, formatJsonResult, getToolVersion, TOOLS };
