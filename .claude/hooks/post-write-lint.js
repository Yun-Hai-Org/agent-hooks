#!/usr/bin/env bun
/**
 * Post-Write Lint - PostToolUse Hook for Edit|Write
 * 文件写入后的代码质量检查
 *
 * 功能：
 * 1. 从 stdin 读取 JSON 输入
 * 2. 根据文件类型执行对应的 lint 检查
 * 3. JSONL 日志记录
 *
 * 支持的文件类型：
 * - Python: Ruff + Pyright (单文件)
 * - JavaScript/TypeScript: ESLint + prettier
 * - Markdown: markdownlint + prettier
 * - JSON: jq 验证
 * - YAML: yq 验证
 */

import { existsSync } from 'fs';
import { extname, basename, join } from 'path';
import { execSync } from 'child_process';
import { appendFileSync, mkdirSync } from 'fs';

const LOG_DIR = join(process.env.HOME || '', '.claude', 'hooks-logs');

function log(data) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'post-write-lint', ...data }) + '\n');
  } catch {}
}

function getFilePath() {
  // 从环境变量获取（兼容旧方式）
  const envPath = process.env.CLAUDE_FILE_PATH;
  if (envPath) return envPath;

  // 从环境变量 TOOL_INPUT 获取
  try {
    const toolInput = process.env.CLAUDE_TOOL_INPUT;
    if (toolInput) {
      const input = JSON.parse(toolInput);
      return input.file_path || input.path || '';
    }
  } catch {}

  return '';
}

function shouldIgnoreFile(filePath) {
  const ignorePatterns = [
    'node_modules/',
    '__pycache__/',
    '.git/',
    'dist/',
    'build/',
    '.venv/',
    'venv/',
    'bun.lock',
    'uv.lock',
    '.min.',
    '.bundle.',
  ];
  return ignorePatterns.some((pattern) => filePath.includes(pattern));
}

function isGitIgnored(filePath, cwd) {
  try {
    execSync(`git check-ignore -q "${filePath}"`, { cwd, stdio: 'pipe' });
    return true; // exit 0 = is ignored
  } catch {
    return false; // exit non-zero = not ignored
  }
}

function execCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message,
    };
  }
}

function lintPython(filePath) {
  console.log(`🐍 Python 严格校验: ${filePath}`);
  let success = true;

  // ruff check (lint + 自动修复 + preview 模式)
  if (execCommand('which ruff').success) {
    const lintResult = execCommand(`ruff check --preview --fix "${filePath}"`);
    if (!lintResult.success) {
      console.log('   ❌ ruff lint 发现问题（严格模式）');
      console.log(lintResult.error.split('\n').slice(0, 20).join('\n'));
      success = false;
    } else {
      console.log('   ✅ ruff lint 检查通过（严格模式）');
    }

    // ruff format
    const formatCheck = execCommand(`ruff format --check "${filePath}"`);
    if (!formatCheck.success) {
      execCommand(`ruff format "${filePath}"`);
      console.log('   ✅ ruff 格式化完成');
    } else {
      console.log('   ✅ ruff 格式已符合规范');
    }
  } else {
    console.log('   ⚠️  ruff 未安装，跳过 Python lint');
  }

  // pyright 类型检查（单文件模式）
  const pyrightAvailable = execCommand('which pyright').success || execCommand('which uv').success;
  if (pyrightAvailable) {
    const pyrightCmd = execCommand('which pyright').success ? 'pyright' : 'uv run pyright';
    const pyrightResult = execCommand(`${pyrightCmd} "${filePath}"`);
    if (!pyrightResult.success) {
      console.log('   ❌ pyright 类型检查失败（严格模式）');
      const lines = (pyrightResult.output + pyrightResult.error).split('\n');
      const errors = lines.filter((l) => l.includes('error') || l.includes('Error')).slice(0, 10);
      if (errors.length > 0) {
        console.log(errors.join('\n'));
      }
      success = false;
    } else {
      console.log('   ✅ pyright 类型检查通过（严格模式）');
    }
  } else {
    console.log('   ⚠️  pyright/uv 未安装，跳过类型检查');
  }

  return success;
}

function lintTypescriptJavascript(filePath) {
  console.log(`📦 TS/JS 严格校验: ${filePath}`);
  let success = true;

  if (!execCommand('which bun').success) {
    console.log('   ⚠️  bun 未安装，跳过 TS/JS 校验');
    return true;
  }

  // prettier 格式化
  execCommand(`bunx prettier --write "${filePath}"`);
  console.log('   ✅ prettier 格式化完成');

  // eslint 检查（严格模式，--max-warnings 0，报告未使用的禁用指令）
  const eslintResult = execCommand(
    `bunx eslint --max-warnings 0 --report-unused-disable-directives --fix "${filePath}"`,
  );
  if (!eslintResult.success) {
    console.log('   ❌ eslint 发现问题（严格模式）');
    console.log(eslintResult.error.split('\n').slice(0, 20).join('\n'));
    success = false;
  } else {
    console.log('   ✅ eslint 检查通过（严格模式）');
  }

  return success;
}

function lintMarkdown(filePath) {
  console.log(`📝 Markdown 严格校验: ${filePath}`);
  let success = true;

  if (!execCommand('which bun').success) {
    console.log('   ⚠️  bun 未安装，跳过 Markdown 校验');
    return true;
  }

  // prettier 格式化
  execCommand(`bunx prettier --write "${filePath}"`);
  console.log('   ✅ prettier 格式化完成');

  // markdownlint 检查
  const result = execCommand(`bunx markdownlint-cli2 fix "${filePath}"`);
  if (!result.success) {
    console.log('   ❌ markdownlint 发现问题（严格模式）');
    console.log(result.error.split('\n').slice(0, 15).join('\n'));
    success = false;
  } else {
    console.log('   ✅ markdownlint 检查通过（严格模式）');
  }

  return success;
}

function lintJson(filePath) {
  console.log(`⚙️  JSON 校验: ${filePath}`);

  if (!execCommand('which jq').success) {
    console.log('   ⚠️  jq 未安装，跳过 JSON 验证');
    return true;
  }

  if (execCommand(`jq empty "${filePath}"`).success) {
    console.log('   ✅ JSON 格式正确');
    return true;
  }

  console.log('   ❌ JSON 格式错误');
  return false;
}

function lintYaml(filePath) {
  console.log(`⚙️  YAML 校验: ${filePath}`);

  if (!execCommand('which yq').success) {
    console.log('   ⚠️  yq 未安装，跳过 YAML 验证');
    return true;
  }

  if (execCommand(`yq eval '.' "${filePath}" > /dev/null`).success) {
    console.log('   ✅ YAML 格式正确');
    return true;
  }

  console.log('   ❌ YAML 格式错误');
  return false;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let filePath = '';
  let toolName = '';
  let sessionId = '';
  let cwd = '';

  try {
    const data = JSON.parse(input);
    toolName = data.tool_name || '';
    filePath = data.tool_input?.file_path || '';
    sessionId = data.session_id || '';
    cwd = data.cwd || '';
  } catch {
    // 兼容旧方式：从环境变量获取
    filePath = getFilePath();
  }

  // 如果没有文件路径，尝试从环境变量获取
  if (!filePath) {
    filePath = getFilePath();
  }

  if (!filePath || !existsSync(filePath) || shouldIgnoreFile(filePath) || isGitIgnored(filePath, cwd)) {
    log({ level: 'SKIP', reason: 'no file or ignored', file: filePath, tool: toolName, session: sessionId });
    console.log('{}');
    return;
  }

  const extension = extname(filePath).slice(1).toLowerCase();
  let success = true;

  log({ level: 'LINT_START', file: filePath, extension, tool: toolName, session: sessionId });

  switch (extension) {
    case 'py':
      success = lintPython(filePath);
      break;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'mjs':
    case 'cjs':
      success = lintTypescriptJavascript(filePath);
      break;
    case 'md':
    case 'mdx':
      success = lintMarkdown(filePath);
      break;
    case 'json':
      success = lintJson(filePath);
      break;
    case 'yaml':
    case 'yml':
      success = lintYaml(filePath);
      break;
    default:
      log({ level: 'SKIP', reason: 'unsupported extension', file: filePath, extension });
      console.log('{}');
      return;
  }

  if (!success) {
    console.log(`\n❌ 校验失败: ${basename(filePath)}`);
    log({ level: 'LINT_FAILED', file: filePath, extension, tool: toolName, session: sessionId });
    // PostToolUse hook 不应该阻止操作，只报告结果
    console.log('{}');
  } else {
    log({ level: 'LINT_PASSED', file: filePath, extension, tool: toolName, session: sessionId });
    console.log('{}');
  }
}

main();
