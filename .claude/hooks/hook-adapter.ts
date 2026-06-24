#!/usr/bin/env bun
/**
 * Hook Adapter - 三平台 stdin/stdout 适配
 * HOOK_PLATFORM=claude|cursor|kiro
 */

import { readStdin as readStdinBase } from './security-orchestrator.js';
import type { HookInput, HookPlatform, HookToolInput } from './types.js';

export function getPlatform(): HookPlatform {
  const p = (process.env['HOOK_PLATFORM'] || 'claude').toLowerCase();
  if (p === 'cursor' || p === 'kiro') return p;
  return 'claude';
}

function extractShellCommand(data: Record<string, unknown>): string {
  if (typeof data['command'] === 'string') return data['command'];
  const toolInput = data['tool_input'] || data['toolInput'];
  if (toolInput && typeof toolInput === 'object' && 'command' in toolInput) {
    return String((toolInput as { command?: string })['command'] || '');
  }
  return '';
}

export function isShellTool(toolName?: string): boolean {
  return /^(bash|shell)$/i.test(toolName || '');
}

export function isShellHookInput(data: { tool_name?: string; tool_input?: { command?: string } }): boolean {
  if (isShellTool(data.tool_name)) return true;
  return Boolean(data.tool_input?.command);
}

export function normalizeInput(data: Record<string, unknown>): HookInput {
  const platform = getPlatform();
  if (platform === 'cursor') {
    const command = extractShellCommand(data);
    const isBeforeShell = typeof data['command'] === 'string';
    const toolInput = data['tool_input'] || data['toolInput'];
    const mergedCommand =
      command ||
      (toolInput && typeof toolInput === 'object' && 'command' in toolInput
        ? String((toolInput as { command?: string })['command'] || '')
        : '');
    return {
      tool_name: String(data['tool_name'] || data['toolName'] || (isBeforeShell || command ? 'Shell' : '')),
      tool_input: { command: mergedCommand },
      session_id: String(data['session_id'] || data['conversation_id'] || ''),
      cwd: String(
        data['cwd'] || (Array.isArray(data['workspace_roots']) ? data['workspace_roots'][0] : '') || process.cwd(),
      ),
    };
  }
  if (platform === 'kiro') {
    const toolInput = data['tool_input'] || data['toolInput'];
    return {
      tool_name: String(data['tool_name'] || data['toolName'] || ''),
      tool_input:
        toolInput && typeof toolInput === 'object'
          ? {
              command: 'command' in toolInput ? String((toolInput as { command?: string })['command'] || '') : '',
              file_path:
                'file_path' in toolInput ? String((toolInput as { file_path?: string })['file_path'] || '') : '',
            }
          : {},
      session_id: String(data['session_id'] || data['sessionId'] || ''),
      cwd: String(data['cwd'] || process.cwd()),
    };
  }
  const toolInput = data['tool_input'];
  return {
    tool_name: String(data['tool_name'] || ''),
    tool_input:
      toolInput && typeof toolInput === 'object'
        ? {
            command: 'command' in toolInput ? String((toolInput as { command?: string })['command'] || '') : '',
            file_path: 'file_path' in toolInput ? String((toolInput as { file_path?: string })['file_path'] || '') : '',
          }
        : {},
    session_id: String(data['session_id'] || ''),
    cwd: String(data['cwd'] || process.cwd()),
  };
}

export async function readHookInput(): Promise<HookInput> {
  const raw = await readStdinBase();
  return normalizeInput(raw);
}

export function isFileEditTool(toolName?: string): boolean {
  return /^(edit|write)$/i.test(toolName || '');
}

function parseHookToolInput(rawInput: unknown): HookToolInput {
  const tool_input: HookToolInput = {};
  if (!rawInput || typeof rawInput !== 'object') return tool_input;
  const obj = rawInput as Record<string, unknown>;
  if ('command' in obj) tool_input.command = String(obj['command'] || '');
  if ('file_path' in obj) tool_input.file_path = String(obj['file_path'] || '');
  if ('content' in obj) tool_input.content = String(obj['content'] || '');
  if ('new_string' in obj) tool_input.new_string = String(obj['new_string'] || '');
  return tool_input;
}

export function normalizeFileEditInput(data: Record<string, unknown>): HookInput {
  const platform = getPlatform();
  if (platform === 'cursor' && typeof data['file_path'] === 'string') {
    const roots = data['workspace_roots'];
    return {
      tool_name: 'Write',
      tool_input: { file_path: data['file_path'] },
      session_id:
        typeof data['session_id'] === 'string'
          ? data['session_id']
          : typeof data['conversation_id'] === 'string'
            ? data['conversation_id']
            : '',
      cwd:
        typeof data['cwd'] === 'string'
          ? data['cwd']
          : Array.isArray(roots) && typeof roots[0] === 'string'
            ? roots[0]
            : process.cwd(),
    };
  }
  const rawInput = data['tool_input'] || data['toolInput'];
  const tool_input = parseHookToolInput(rawInput);
  return {
    tool_name: String(data['tool_name'] || data['toolName'] || ''),
    tool_input,
    session_id:
      typeof data['session_id'] === 'string'
        ? data['session_id']
        : typeof data['conversation_id'] === 'string'
          ? data['conversation_id']
          : '',
    cwd: typeof data['cwd'] === 'string' ? data['cwd'] : process.cwd(),
  };
}

export async function readFileEditInput(): Promise<HookInput> {
  const raw = await readStdinBase();
  return normalizeFileEditInput(raw);
}

export function formatDenyOutput(decision: string, reason: string): string {
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

export function formatAllowOutput(): string {
  return formatDenyOutput('allow', '');
}

export function formatStopContinueOutput(reason: string, _hookEvent = 'Stop'): string {
  const platform = getPlatform();
  if (platform === 'cursor') {
    return JSON.stringify({ followup_message: reason });
  }
  return JSON.stringify({ decision: 'block', reason });
}

export function formatStopSuccessOutput(message: string, hookEvent = 'Stop'): string {
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
