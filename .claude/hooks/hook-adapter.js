#!/usr/bin/env bun
/**
 * Hook Adapter - 三平台 stdin/stdout 适配
 * HOOK_PLATFORM=claude|cursor|kiro
 */

import { readStdin as readStdinBase } from './security-orchestrator.js';

/** @typedef {'claude' | 'cursor' | 'kiro'} HookPlatform */

/**
 * @typedef {object} HookToolInput
 * @property {string} [command]
 * @property {string} [file_path]
 * @property {string} [content]
 * @property {string} [new_string]
 */

/**
 * @typedef {object} HookInput
 * @property {string} tool_name
 * @property {HookToolInput} tool_input
 * @property {string} session_id
 * @property {string} cwd
 */

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

/** @param {Record<string, unknown>} data @returns {HookInput} */
export function normalizeInput(data) {
  const platform = getPlatform();
  if (platform === 'cursor') {
    const command = extractShellCommand(data);
    const isBeforeShell = typeof data.command === 'string';
    const toolInput = data.tool_input || data.toolInput;
    const mergedCommand =
      command ||
      (toolInput && typeof toolInput === 'object' && 'command' in toolInput
        ? String(/** @type {{ command?: string }} */ (toolInput).command || '')
        : '');
    return {
      tool_name: String(data.tool_name || data.toolName || (isBeforeShell || command ? 'Shell' : '')),
      tool_input: { command: mergedCommand },
      session_id: String(data.session_id || data.conversation_id || ''),
      cwd: String(data.cwd || (Array.isArray(data.workspace_roots) ? data.workspace_roots[0] : '') || process.cwd()),
    };
  }
  if (platform === 'kiro') {
    const toolInput = data.tool_input || data.toolInput;
    return {
      tool_name: String(data.tool_name || data.toolName || ''),
      tool_input:
        toolInput && typeof toolInput === 'object'
          ? {
              command:
                'command' in toolInput ? String(/** @type {{ command?: string }} */ (toolInput).command || '') : '',
              file_path:
                'file_path' in toolInput
                  ? String(/** @type {{ file_path?: string }} */ (toolInput).file_path || '')
                  : '',
            }
          : {},
      session_id: String(data.session_id || data.sessionId || ''),
      cwd: String(data.cwd || process.cwd()),
    };
  }
  const toolInput = data.tool_input;
  return {
    tool_name: String(data.tool_name || ''),
    tool_input:
      toolInput && typeof toolInput === 'object'
        ? {
            command:
              'command' in toolInput ? String(/** @type {{ command?: string }} */ (toolInput).command || '') : '',
            file_path:
              'file_path' in toolInput ? String(/** @type {{ file_path?: string }} */ (toolInput).file_path || '') : '',
          }
        : {},
    session_id: String(data.session_id || ''),
    cwd: String(data.cwd || process.cwd()),
  };
}

/** @returns {Promise<HookInput>} */
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
  const rawInput = data.tool_input || data.toolInput;
  /** @type {HookToolInput} */
  const tool_input =
    rawInput && typeof rawInput === 'object'
      ? {
          command:
            'command' in rawInput ? String(/** @type {{ command?: string }} */ (rawInput).command || '') : undefined,
          file_path:
            'file_path' in rawInput
              ? String(/** @type {{ file_path?: string }} */ (rawInput).file_path || '')
              : undefined,
          content:
            'content' in rawInput ? String(/** @type {{ content?: string }} */ (rawInput).content || '') : undefined,
          new_string:
            'new_string' in rawInput
              ? String(/** @type {{ new_string?: string }} */ (rawInput).new_string || '')
              : undefined,
        }
      : {};
  return {
    tool_name: String(data.tool_name || data.toolName || ''),
    tool_input,
    session_id:
      typeof data.session_id === 'string'
        ? data.session_id
        : typeof data.conversation_id === 'string'
          ? data.conversation_id
          : '',
    cwd: typeof data.cwd === 'string' ? data.cwd : process.cwd(),
  };
}

/**
 *
 */
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

/**
 *
 */
export function formatAllowOutput() {
  return formatDenyOutput('allow', '');
}

/**
 * Stop / stop hook：质量门失败时阻止结束并驱动 Agent 继续修复
 * @param {string} reason
 * @param {string} [_hookEvent]
 */
export function formatStopContinueOutput(reason, _hookEvent = 'Stop') {
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
