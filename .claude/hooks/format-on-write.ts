#!/usr/bin/env bun
/**
 * Format On Write - afterFileEdit Hook
 * Agent 写入文件后自动 prettier/markdownlint/ruff/shfmt/taplo 格式化
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, isAbsolute } from 'path';
import { LOG_DIR, execCommand } from './security-orchestrator.js';
import { readFileEditInput, isFileEditTool } from './hook-adapter.js';
import { isInGitRepo } from './auto-stage.js';
import { formatFileOnWrite } from './checks/format-on-write.js';
import { isAbsPathInScanScope } from './checks/scan-scope.js';
import { isGateNodeEnabled } from './gate-config.js';

function log(data: Record<string, unknown>) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'format-on-write', ...data }) + '\n');
  } catch {}
}

async function main() {
  try {
    const data = await readFileEditInput();
    const { tool_name, tool_input, session_id, cwd } = data;

    if (!isFileEditTool(tool_name)) {
      log({ level: 'SKIP', reason: `unsupported tool: ${tool_name || '(empty)'}`, session_id });
      console.log('{}');
      return;
    }

    const filePath = tool_input.file_path;
    if (!filePath || typeof filePath !== 'string') {
      log({ level: 'SKIP', reason: 'no file_path', tool: tool_name, session_id });
      console.log('{}');
      return;
    }

    const absPath = isAbsolute(filePath) ? filePath : join(cwd, filePath);

    if (!existsSync(absPath)) {
      log({ level: 'SKIP', reason: 'file not found', file: absPath, session_id });
      console.log('{}');
      return;
    }

    if (!isInGitRepo(absPath)) {
      log({ level: 'SKIP', reason: 'not in git repo', file: absPath, session_id });
      console.log('{}');
      return;
    }

    if (process.env['CLAUDE_HOOK_PREVIOUS_DENIED'] === 'true') {
      log({ level: 'SKIP', reason: 'previous hook denied', file: absPath, session_id });
      console.log('{}');
      return;
    }

    const gitRootResult = execCommand('git rev-parse --show-toplevel', { cwd: absPath });
    const gitRoot = gitRootResult.success && gitRootResult.stdout.trim() ? gitRootResult.stdout.trim() : cwd;

    if (!isGateNodeEnabled('ide.format-on-write', gitRoot)) {
      log({ level: 'SKIP', reason: 'format-on-write 未在 quality-gate.yaml 中启用', file: absPath, session_id });
      console.log('{}');
      return;
    }

    if (!isAbsPathInScanScope(absPath, gitRoot)) {
      log({ level: 'SKIP', reason: '文件不在 settings.scanScope 范围内', file: absPath, session_id });
      process.stdout.write('{}\n');
      return;
    }

    const result = await formatFileOnWrite(absPath, gitRoot);
    if (result.formatted) {
      log({ level: 'FORMATTED', file: absPath, tools: result.tools, session_id });
    } else if (result.skipped.length > 0) {
      log({ level: 'SKIP', file: absPath, skipped: result.skipped, session_id });
    } else if (result.errors.length > 0) {
      log({ level: 'WARN', file: absPath, errors: result.errors, session_id });
      // BEST-EFFORT / LOG-ONLY: stderr 仅到达终端/日志，Claude Code hook 协议不保证将其注入模型上下文。
      // 可靠的结构化透传仍由提交门（extended-lint details.output）承担。绝不影响 stdout 放行语义。
      try {
        const errLines = result.errors.map((e) => `  ${e}`).join('\n');
        process.stderr.write(`⚠️ [format-on-write] ${absPath}\n${errLines}\n`);
      } catch {
        // stderr 写入失败不应影响放行
      }
    }

    console.log('{}');
  } catch (/** @type {unknown} */ e) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    console.log('{}');
  }
}

if (import.meta.main) {
  void main();
}

export { formatFileOnWrite, log };
