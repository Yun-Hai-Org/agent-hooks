#!/usr/bin/env bun
/**
 * Orchestrator Gate - beforeReadFile / preToolUse Read|Write
 * Denies Orchestrator (no agent_id) direct Read/Write; complements workflow-gate.
 */

import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, readStdin } from './security-orchestrator.js';
import {
  normalizeInput,
  normalizeFileEditInput,
  formatDenyOutput,
  formatAllowOutput,
  getPlatform,
} from './hook-adapter.js';
import { asString } from './types.js';
import { isGateNodeEnabled } from './gate-config.js';
import { isAllowedPathOnMain } from './branch-gate.js';

const HOOK_NAME = 'orchestrator-gate';

function log(data: Record<string, unknown>) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: HOOK_NAME, ...data }) + '\n');
  } catch {}
}

function deny(reason: string) {
  return formatDenyOutput('deny', reason);
}

function emit(out: string) {
  process.stdout.write(`${out}\n`);
}

function allow() {
  return formatAllowOutput();
}

function isReadTool(toolName: string): boolean {
  return /^(read|tabread)$/i.test(toolName);
}

function isWriteTool(toolName: string): boolean {
  return /^(write|edit|tabwrite)$/i.test(toolName);
}

export function isOrchestrator(raw: Record<string, unknown>): boolean {
  return !asString(raw['agent_id']);
}

async function readGateInput() {
  const raw = await readStdin();
  const platform = getPlatform();

  if (platform === 'cursor' && typeof raw['file_path'] === 'string' && !raw['tool_name'] && !raw['toolName']) {
    const data = normalizeFileEditInput(raw);
    return { raw, data: { ...data, tool_name: 'Read' } };
  }

  const data = normalizeInput(raw);
  let tool_name = data.tool_name;
  if (/^write$/i.test(tool_name)) tool_name = 'Write';
  if (/^read$/i.test(tool_name)) tool_name = 'Read';
  return { raw, data: { ...data, tool_name } };
}

async function main() {
  try {
    const { raw, data } = await readGateInput();
    const { tool_name, session_id, cwd } = data;
    const workingDir = cwd || process.cwd();

    if (!isGateNodeEnabled('ide.orchestrator-gate', workingDir)) {
      emit(allow());
      return;
    }

    const isRead = isReadTool(tool_name) || tool_name === 'Read';
    const isWrite = isWriteTool(tool_name);

    if (!isRead && !isWrite) {
      emit(allow());
      return;
    }

    if (!isOrchestrator(raw)) {
      emit(allow());
      return;
    }

    if (isRead) {
      emit(allow());
      return;
    }

    const filePath = (data.tool_input?.file_path as string) ?? '';
    if (isAllowedPathOnMain(filePath)) {
      emit(allow());
      return;
    }

    log({ level: 'BLOCKED', reason: 'orchestrator direct tool', tool: tool_name, session_id });
    const action = isRead ? 'Read' : 'Write';
    emit(
      deny(
        `🔒 [orchestrator-gate] 禁止 Orchestrator 直接 ${action}。请 Task(background) dispatch ${isRead ? 'explore' : 'implementer'} 子代理。`,
      ),
    );
  } catch (e: unknown) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    emit(allow());
  }
}

if (import.meta.main) {
  void main();
}

export { HOOK_NAME, isReadTool, isWriteTool, main };
