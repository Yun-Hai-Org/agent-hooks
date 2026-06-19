#!/usr/bin/env bun
/**
 * Hook Adapter - 三平台 stdin/stdout 适配
 * HOOK_PLATFORM=claude|cursor|kiro
 */

import { readStdin as readStdinBase } from './security-orchestrator.js';

/** @typedef {'claude' | 'cursor' | 'kiro'} HookPlatform */

/** @returns {HookPlatform} */
export function getPlatform() {
  const p = (process.env.HOOK_PLATFORM || 'claude').toLowerCase();
  if (p === 'cursor' || p === 'kiro') return p;
  return 'claude';
}

/** @param {Record<string, unknown>} data */
function extractShellCommand(data) {
  if (typeof data.command === 'string') return data.command;
  const toolInput = data.tool_input || data.toolInput;
  if (toolInput && typeof toolInput === 'object' && 'command' in toolInput) {
    return String(/** @type {{ command?: string }} */ (toolInput).command || '');
  }
  return '';
}

/** @param {string} [toolName] */
export function isShellTool(toolName) {
  return /^(bash|shell)$/i.test(toolName || '');
}

/** @param {{ tool_name?: string; tool_input?: { command?: string } }} data */
export function isShellHookInput(data) {
  if (isShellTool(data.tool_name)) return true;
  return Boolean(data.tool_input?.command);
}

/** @param {Record<string, unknown>} data */
export function normalizeInput(data) {
  const platform = getPlatform();
  if (platform === 'cursor') {
    const command = extractShellCommand(data);
    const isBeforeShell = typeof data.command === 'string';
    const toolInput = data.tool_input || data.toolInput;
    return {
      tool_name: data.tool_name || data.toolName || (isBeforeShell || command ? 'Shell' : ''),
      tool_input:
        toolInput && typeof toolInput === 'object'
          ? { .../** @type {object} */ (toolInput), command: command || /** @type {{ command?: string }} */ (toolInput).command || '' }
          : { command },
      session_id: data.session_id || data.conversation_id || '',
      cwd: data.cwd || data.workspace_roots?.[0] || process.cwd(),
    };
  }
  if (platform === 'kiro') {
    return {
      tool_name: data.tool_name || data.toolName || '',
      tool_input: data.tool_input || data.toolInput || {},
      session_id: data.session_id || data.sessionId || '',
      cwd: data.cwd || process.cwd(),
    };
  }
  return {
    tool_name: data.tool_name || '',
    tool_input: data.tool_input || {},
    session_id: data.session_id || '',
    cwd: data.cwd || process.cwd(),
  };
}

export async function readHookInput() {
  const raw = await readStdinBase();
  return normalizeInput(raw);
}

/** @param {string} [toolName] */
export function isFileEditTool(toolName) {
  return /^(edit|write)$/i.test(toolName || '');
}

/** @param {Record<string, unknown>} data */
export function normalizeFileEditInput(data) {
  const platform = getPlatform();
  if (platform === 'cursor' && typeof data.file_path === 'string') {
    const roots = data.workspace_roots;
    return {
      tool_name: 'Write',
      tool_input: { file_path: data.file_path },
      session_id:
        typeof data.session_id === 'string'
          ? data.session_id
          : typeof data.conversation_id === 'string'
            ? data.conversation_id
            : '',
      cwd:
        typeof data.cwd === 'string'
          ? data.cwd
          : Array.isArray(roots) && typeof roots[0] === 'string'
            ? roots[0]
            : process.cwd(),
    };
  }
  const toolInput = data.tool_input || data.toolInput || {};
  return {
    tool_name: data.tool_name || data.toolName || '',
    tool_input: toolInput,
    session_id:
      typeof data.session_id === 'string'
        ? data.session_id
        : typeof data.conversation_id === 'string'
          ? data.conversation_id
          : '',
    cwd: typeof data.cwd === 'string' ? data.cwd : process.cwd(),
  };
}

export async function readFileEditInput() {
  const raw = await readStdinBase();
  return normalizeFileEditInput(raw);
}

/**
 * @param {string} decision
 * @param {string} reason
 */
export function formatDenyOutput(decision, reason) {
  const platform = getPlatform();
  if (platform === 'cursor') {
    if (decision === 'allow') {
      return JSON.stringify({ permission: 'allow' });
    }
    return JSON.stringify({
      permission: 'deny',
      user_message: reason,
      agent_message: reason,
    });
  }
  if (platform === 'kiro') {
    if (decision === 'allow') {
      return JSON.stringify({ decision: 'allow' });
    }
    return JSON.stringify({ decision: 'deny', reason });
  }
  if (decision === 'allow') return '{}';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

export function formatAllowOutput() {
  return formatDenyOutput('allow', '');
}

/**
 * Stop / stop hook：质量门失败时阻止结束并驱动 Agent 继续修复
 * @param {string} reason
 * @param {string} [hookEvent]
 */
export function formatStopContinueOutput(reason, hookEvent = 'Stop') {
  const platform = getPlatform();
  if (platform === 'cursor') {
    return JSON.stringify({ followup_message: reason });
  }
  return JSON.stringify({ decision: 'block', reason });
}

/**
 * Stop / stop hook：提交成功时的上下文反馈（Claude additionalContext）
 * @param {string} message
 * @param {string} [hookEvent]
 */
export function formatStopSuccessOutput(message, hookEvent = 'Stop') {
  const platform = getPlatform();
  if (platform === 'cursor') {
    return '{}';
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: hookEvent || 'Stop',
      additionalContext: message,
    },
  });
}
