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
 * - Shell: shfmt + shellcheck
 * - Dockerfile: hadolint
 * - SQL: sqlfluff
 * - TOML: taplo
 * - CSS/SCSS/LESS: stylelint + prettier
 */

import { existsSync, readFileSync } from 'fs';
import { extname, basename, dirname, join } from 'path';
import { execSync } from 'child_process';
import { appendFileSync, mkdirSync } from 'fs';
import { LOG_DIR } from './security-orchestrator.js';

/**
 * @param {Record<string, unknown>} data
 */
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

/**
 * @param {string} filePath
 */
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

/** @param {string} filePath @param {string} cwd */
function isGitIgnored(filePath, cwd) {
  try {
    execSync(`git check-ignore -q "${filePath}"`, { cwd, stdio: 'pipe' });
    return true; // exit 0 = is ignored
  } catch {
    return false; // exit non-zero = not ignored
  }
}

/** @param {string} command @param {Record<string, unknown>} [options] */
function execCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      ...options,
    });
    return { success: true, output: result };
  } catch (/** @type {any} */ error) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message,
    };
  }
}

/** @param {string} filePath */
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
      const errors = lines.filter((/** @type {string} */ l) => l.includes('error') || l.includes('Error')).slice(0, 10);
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

/** @param {string} filePath */
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

/** @param {string} filePath */
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

/**
 * Schema 查找策略：
 * 1. 文件内 $schema 字段
 * 2. 同目录 {baseName}.schema.json
 * 3. 项目根目录 schemas/ 或 _schemas/ 下匹配
 * @param {string} filePath
 * @returns {string|null} schema 文件路径，未找到返回 null
 */
function findSchemaFile(filePath) {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const baseName = basename(filePath, ext);

  // 策略 1: 文件内 $schema 字段（仅 JSON 文件）
  if (ext === '.json') {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.$schema) {
        // 如果是 URL，直接返回（check-jsonschema 支持 URL）
        if (parsed.$schema.startsWith('http://') || parsed.$schema.startsWith('https://')) {
          return parsed.$schema;
        }
        // 如果是本地路径，解析为绝对路径
        const schemaPath = join(dir, parsed.$schema);
        if (existsSync(schemaPath)) return schemaPath;
      }
    } catch {
      // JSON 解析失败，跳过此策略
    }
  }

  // 策略 2: 同目录 {baseName}.schema.json
  const localSchema = join(dir, `${baseName}.schema.json`);
  if (existsSync(localSchema)) return localSchema;

  // 策略 3: 项目根目录 schemas/ 或 _schemas/ 下匹配
  // 从 filePath 向上查找 package.json 或 .git 确定项目根目录
  let rootDir = dir;
  for (let i = 0; i < 10; i++) {
    const parent = dirname(rootDir);
    if (parent === rootDir) break;
    if (existsSync(join(rootDir, 'package.json')) || existsSync(join(rootDir, '.git'))) break;
    rootDir = parent;
  }

  for (const schemaDir of ['schemas', '_schemas']) {
    const candidate = join(rootDir, schemaDir, `${baseName}.schema.json`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * 运行 check-jsonschema 验证
 * @param {string} filePath
 * @param {string|null} schemaPath
 * @param {'json'|'yaml'} format
 * @returns {{success: boolean, output: string, skipped: boolean}}
 */
function runCheckJsonschema(filePath, schemaPath, format) {
  if (!schemaPath) {
    return { success: true, output: '', skipped: true };
  }

  if (!execCommand('which check-jsonschema').success) {
    return { success: true, output: '', skipped: true };
  }

  const formatFlag = format === 'yaml' ? '--format yaml ' : '';
  const result = execCommand(`bunx check-jsonschema ${formatFlag}--schemafile "${schemaPath}" "${filePath}"`);
  return { success: result.success, output: result.error || result.output, skipped: false };
}

/** @param {string} filePath */
function lintJson(filePath) {
  console.log(`⚙️  JSON 校验: ${filePath}`);
  let success = true;

  // 1. prettier 格式化（先执行）
  if (execCommand('which bunx').success) {
    const prettierResult = execCommand(`bunx prettier --write "${filePath}"`);
    if (prettierResult.success) {
      console.log('   ✅ prettier 格式化完成');
    } else {
      console.log('   ⚠️  prettier 格式化失败，跳过');
    }
  } else {
    console.log('   ⏭️  bunx 未安装，跳过 prettier 格式化');
  }

  // 2. check-jsonschema 验证（Schema 查找 → 验证）
  const schemaPath = findSchemaFile(filePath);
  const checkResult = runCheckJsonschema(filePath, schemaPath, 'json');
  if (checkResult.skipped) {
    if (!schemaPath) {
      console.log('   ⏭️  未找到 Schema 文件，跳过 Schema 验证');
    } else {
      console.log('   ⏭️  check-jsonschema 未安装，跳过 Schema 验证');
    }
  } else if (checkResult.success) {
    console.log('   ✅ check-jsonschema Schema 验证通过');
  } else {
    console.log('   ❌ check-jsonschema Schema 验证失败');
    console.log(checkResult.output.split('\n').slice(0, 15).join('\n'));
    success = false;
  }

  // 3. jq 回退校验（兜底语法检查）
  if (execCommand('which jq').success) {
    if (execCommand(`jq empty "${filePath}"`).success) {
      console.log('   ✅ jq JSON 语法校验通过');
    } else {
      console.log('   ❌ jq JSON 语法校验失败');
      success = false;
    }
  } else {
    console.log('   ⏭️  jq 未安装，跳过 JSON 语法校验');
  }

  return success;
}

/** @param {string} filePath */
function lintYaml(filePath) {
  console.log(`⚙️  YAML 校验: ${filePath}`);
  let success = true;

  // 1. prettier 格式化（先执行）
  if (execCommand('which bunx').success) {
    const prettierResult = execCommand(`bunx prettier --write --parser yaml "${filePath}"`);
    if (prettierResult.success) {
      console.log('   ✅ prettier 格式化完成');
    } else {
      console.log('   ⚠️  prettier 格式化失败，跳过');
    }
  } else {
    console.log('   ⏭️  bunx 未安装，跳过 prettier 格式化');
  }

  // 2. check-jsonschema 验证（Schema 查找 → 验证）
  const schemaPath = findSchemaFile(filePath);
  const checkResult = runCheckJsonschema(filePath, schemaPath, 'yaml');
  if (checkResult.skipped) {
    if (!schemaPath) {
      console.log('   ⏭️  未找到 Schema 文件，跳过 Schema 验证');
    } else {
      console.log('   ⏭️  check-jsonschema 未安装，跳过 Schema 验证');
    }
  } else if (checkResult.success) {
    console.log('   ✅ check-jsonschema Schema 验证通过');
  } else {
    console.log('   ❌ check-jsonschema Schema 验证失败');
    console.log(checkResult.output.split('\n').slice(0, 15).join('\n'));
    success = false;
  }

  // 3. yq 回退校验（兜底语法检查）
  if (execCommand('which yq').success) {
    if (execCommand(`yq eval '.' "${filePath}" > /dev/null`).success) {
      console.log('   ✅ yq YAML 语法校验通过');
    } else {
      console.log('   ❌ yq YAML 语法校验失败');
      success = false;
    }
  } else {
    console.log('   ⏭️  yq 未安装，跳过 YAML 语法校验');
  }

  return success;
}

/** @param {string} filePath */
function lintShell(filePath) {
  console.log(`🐚 Shell 严格校验: ${filePath}`);
  let success = true;

  // 1. shfmt 格式化（先执行，修复风格问题）
  if (execCommand('which shfmt').success) {
    const shfmtCheck = execCommand(`shfmt -d "${filePath}"`);
    if (!shfmtCheck.success) {
      execCommand(`shfmt -w "${filePath}"`);
      console.log('   ✅ shfmt 格式化完成');
    } else {
      console.log('   ✅ shfmt 格式已符合规范');
    }
  } else {
    console.log('   ⏭️  shfmt 未安装，跳过 Shell 格式化');
  }

  // 2. shellcheck 静态分析（后执行，检测安全隐患）
  if (execCommand('which shellcheck').success) {
    const shellcheckResult = execCommand(`shellcheck "${filePath}"`);
    if (!shellcheckResult.success) {
      console.log('   ❌ shellcheck 发现问题（严格模式）');
      console.log(shellcheckResult.error.split('\n').slice(0, 20).join('\n'));
      success = false;
    } else {
      console.log('   ✅ shellcheck 检查通过（严格模式）');
    }
  } else {
    console.log('   ⏭️  shellcheck 未安装，跳过 Shell 静态分析');
  }

  return success;
}

/**
 * hadolint 安全相关规则 → 严重级别映射
 * HIGH: 影响镜像安全的规则（基础镜像标签、以 root 运行、COPY --chown 等）
 * MEDIUM: 影响最佳实践的规则（JSON 格式、apt-get 清理等）
 */
const HADOLINT_SECURITY_RULES = Object.freeze({
  // HIGH — 安全性规则
  DL3006: 'HIGH', // Always tag the version of an image explicitly
  DL3023: 'HIGH', // COPY --from should reference a previously defined FROM alias
  DL3025: 'HIGH', // Use JSON notation for CMD/ENTRYPOINT
  DL3002: 'HIGH', // Last USER should not be root
  DL3003: 'HIGH', // Use WORKDIR instead of cd
  DL3007: 'HIGH', // Using latest is not recommended
  DL3008: 'HIGH', // Pin versions in apt-get install
  DL3009: 'HIGH', // Delete the apt-get lists after installing
  DL3018: 'HIGH', // Pin versions in apk add
  DL3019: 'HIGH', // Use the --no-cache switch
  DL3020: 'HIGH', // Use COPY instead of ADD for files
  DL3022: 'HIGH', // COPY --from should reference a previously defined FROM alias
  DL3024: 'HIGH', // FROM aliases (stage names) must be unique
  DL4006: 'HIGH', // Set the SHELL option -o pipefail before RUN with a pipe

  // MEDIUM — 最佳实践规则
  DL3010: 'MEDIUM', // Use ADD for archives that need auto-unpacking
  DL3011: 'MEDIUM', // Valid EXPOSE port range
  DL3012: 'MEDIUM', // Multiple ENV not allowed
  DL3013: 'MEDIUM', // Pin versions in pip install
  DL3015: 'MEDIUM', // Avoid additional packages with apt-get install
  DL3016: 'MEDIUM', // Pin versions in npm install
  DL3021: 'MEDIUM', // COPY requires at least 2 arguments
  DL3028: 'MEDIUM', // Pin versions in gem install
  DL3038: 'MEDIUM', // Pin versions in dnf install
  DL3039: 'MEDIUM', // Do not use dnf update
  DL4001: 'MEDIUM', // Either use Wget or Curl but not both
  DL4003: 'MEDIUM', // Use WORKDIR to switch to a directory
  DL4005: 'MEDIUM', // Use SHELL to change the default shell
});

/**
 * 获取 hadolint 规则的严重级别
 * 优先使用 hadolint 原生的 error/warning 分类，再叠加安全规则映射
 * @param {string} hadolintSeverity - hadolint 原生级别 (error/warning/info/style)
 * @param {string} ruleId - 规则 ID (如 DL3006)
 * @returns {string} 严重级别
 */
function getHadolintSeverity(hadolintSeverity, ruleId) {
  // hadolint error → CRITICAL
  if (hadolintSeverity === 'error') return 'CRITICAL';

  // 安全规则映射优先
  const ruleSeverity = HADOLINT_SECURITY_RULES[ruleId];
  if (ruleSeverity) return ruleSeverity;

  // hadolint warning → HIGH
  if (hadolintSeverity === 'warning') return 'HIGH';

  // 其他（info/style）→ MEDIUM
  return 'MEDIUM';
}

/**
 * 解析 hadolint 输出为结构化结果
 * 输出格式: "file:line col: severity message [DLxxxx]"
 * hadolint 可能输出 ANSI 颜色码，需先剥离
 * @param {string} output - hadolint 原始输出
 * @returns {Array<{file: string, line: number, severity: string, ruleId: string, message: string}>}
 */
function parseHadolintOutput(output) {
  const results = [];
  // 剥离 ANSI 颜色转义码
  // eslint-disable-next-line no-control-regex
  const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = cleanOutput.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    // 匹配格式: "Dockerfile:1:2: DL3006 warning: message" 或 "Dockerfile:1 DL3006 warning: message"
    const match = line.match(/^(.+?):(\d+)(?::\d+)?:?\s+(DL\d+)\s+(\w+):\s+(.+)$/);
    if (match) {
      const [, file, lineNum, ruleId, hadolintSev, message] = match;
      results.push({
        file,
        line: parseInt(lineNum, 10),
        severity: getHadolintSeverity(hadolintSev, ruleId),
        ruleId,
        message: message.trim(),
      });
    }
  }

  return results;
}

/** @param {string} filePath */
function lintDockerfile(filePath) {
  console.log(`🐳 Dockerfile 严格校验: ${filePath}`);

  if (!execCommand('which hadolint').success) {
    console.log('   ⏭️  hadolint 未安装，跳过 Dockerfile 校验（fail-open）');
    return true; // fail-open
  }

  const hadolintResult = execCommand(`hadolint "${filePath}"`);
  if (!hadolintResult.success) {
    const rawOutput = hadolintResult.output || hadolintResult.error;
    const issues = parseHadolintOutput(rawOutput);

    if (issues.length > 0) {
      console.log('   ❌ hadolint 发现问题:');
      // 按严重级别排序: CRITICAL > HIGH > MEDIUM
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
      issues.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

      for (const issue of issues.slice(0, 15)) {
        console.log(`   [${issue.severity}] ${issue.ruleId}: ${issue.file}:${issue.line} — ${issue.message}`);
      }
      if (issues.length > 15) {
        console.log(`   ... 还有 ${issues.length - 15} 个问题`);
      }
    } else {
      // 解析失败时回退到原始输出
      console.log('   ❌ hadolint 发现问题（原始输出）');
      console.log(rawOutput.split('\n').slice(0, 15).join('\n'));
    }
    return false;
  }

  console.log('   ✅ hadolint 检查通过（严格模式）');
  return true;
}

/** @param {string} filePath */
function lintToml(filePath) {
  console.log(`⚙️  TOML 校验: ${filePath}`);

  if (!execCommand('which taplo').success) {
    console.log('   ⏭️  taplo 未安装，跳过 TOML 校验（fail-open）');
    return true; // fail-open
  }

  // taplo format --check 仅检查格式，不修改文件
  const checkResult = execCommand(`taplo format --check "${filePath}"`);
  if (!checkResult.success) {
    console.log('   ❌ taplo 格式检查失败');
    const errorOutput = checkResult.error || checkResult.output;
    // 输出 taplo 的具体错误信息（限制行数避免过长）
    const lines = errorOutput
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 15);
    if (lines.length > 0) {
      console.log(lines.join('\n'));
    }
    return false;
  }

  console.log('   ✅ taplo 格式检查通过');
  return true;
}

/**
 * CSS/SCSS/LESS 校验：stylelint + prettier
 * 策略：先 prettier 格式化，再 stylelint 静态分析（fail-open）
 * @param {string} filePath
 */
function lintCss(filePath) {
  console.log(`🎨 CSS 校验: ${filePath}`);

  if (!execCommand('which bun').success) {
    console.log('   ⏭️  bun 未安装，跳过 CSS 校验（fail-open）');
    return true; // fail-open
  }

  // 1. prettier 格式化（先执行，修复风格问题）
  const prettierResult = execCommand(`bunx prettier --write "${filePath}"`);
  if (prettierResult.success) {
    console.log('   ✅ prettier 格式化完成');
  } else {
    console.log('   ⚠️  prettier 格式化失败，跳过');
  }

  // 2. stylelint 静态分析（后执行，检测样式问题）
  if (!execCommand('which bunx').success) {
    console.log('   ⏭️  bunx 未安装，跳过 stylelint（fail-open）');
    return true; // fail-open
  }

  const stylelintResult = execCommand(`bunx stylelint "${filePath}"`);
  if (!stylelintResult.success) {
    const output = stylelintResult.output || stylelintResult.error;

    // 无配置文件时 fail-open：项目未配置样式规则，无需拦截
    if (output.includes('No configuration provided') || output.includes('ConfigurationError')) {
      console.log('   ⏭️  未找到 stylelint 配置文件，跳过（fail-open）');
      return true; // fail-open
    }

    console.log('   ❌ stylelint 发现问题:');
    // stylelint 输出格式: "file:line:col  severity  message  rule-id"
    const lines = output
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 15);
    if (lines.length > 0) {
      console.log(lines.join('\n'));
    } else {
      console.log('   ❌ stylelint 发现问题（无详细输出）');
    }
    return false;
  }

  console.log('   ✅ stylelint 检查通过');
  return true;
}

/** @param {string} filePath */
function lintSql(filePath) {
  console.log(`🗄️  SQL 严格校验: ${filePath}`);

  if (!execCommand('which sqlfluff').success) {
    console.log('   ⏭️  sqlfluff 未安装，跳过 SQL 校验（fail-open）');
    return true; // fail-open
  }

  const result = execCommand(`sqlfluff lint "${filePath}" --dialect ansi`);
  if (!result.success) {
    const output = result.output || result.error;
    if (output.trim()) {
      console.log('   ❌ sqlfluff 发现问题:');
      // sqlfluff 输出格式: "L:   1 | P:   1 | L003 | ..."
      const lines = output.split('\n').filter((l) => l.trim().startsWith('L:'));
      for (const line of lines.slice(0, 15)) {
        console.log(`   ${line.trim()}`);
      }
      if (lines.length > 15) {
        console.log(`   ... 还有 ${lines.length - 15} 个问题`);
      }
    } else {
      console.log('   ❌ sqlfluff 发现问题（无详细输出）');
    }
    return false;
  }

  console.log('   ✅ sqlfluff 检查通过（严格模式）');
  return true;
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
    case 'sh':
    case 'bash':
    case 'zsh':
      success = lintShell(filePath);
      break;
    case 'css':
    case 'scss':
    case 'less':
      success = lintCss(filePath);
      break;
    case 'dockerfile':
      success = lintDockerfile(filePath);
      break;
    case 'sql':
      success = lintSql(filePath);
      break;
    case 'toml':
      success = lintToml(filePath);
      break;
    default:
      // 检查是否是 Dockerfile/Containerfile（无扩展名或 .dockerfile 后缀）
      const filename = basename(filePath).toLowerCase();
      if (filename === 'dockerfile' || filename === 'containerfile' || filename.endsWith('.dockerfile')) {
        success = lintDockerfile(filePath);
      } else {
        log({ level: 'SKIP', reason: 'unsupported extension', file: filePath, extension });
        console.log('{}');
        return;
      }
      break;
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

// 只在直接运行时执行 main，导入时不执行
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1]);
if (isDirectRun) {
  main();
}

export {
  log,
  getFilePath,
  execCommand,
  lintPython,
  lintTypescriptJavascript,
  lintMarkdown,
  lintJson,
  lintYaml,
  lintShell,
  lintDockerfile,
  lintCss,
  lintSql,
  lintToml,
  findSchemaFile,
  runCheckJsonschema,
  shouldIgnoreFile,
  isGitIgnored,
  HADOLINT_SECURITY_RULES,
  getHadolintSeverity,
  parseHadolintOutput,
};
