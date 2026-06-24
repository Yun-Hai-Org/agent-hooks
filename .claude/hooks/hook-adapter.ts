#!/usr/bin/env bun
/**
 * Hook Adapter - 三平台 stdin/stdout 适配
 * HOOK_PLATFORM=claude|cursor|kiro
 */

import { readStdin as readStdinBase } from './security-orchestrator.js';
import type { HookInput, HookPlatform, HookToolInput } from './types.js';
import { asString } from './types.js';

export function getPlatform(): HookPlatform {
  const raw = process.env['HOOK_PLATFORM'];
  const p = (typeof raw === 'string' ? raw : 'claude').toLowerCase();
  if (p === 'cursor' || p === 'kiro') return p;
  return 'claude';
}

function toolInputField(toolInput: unknown, field: 'command' | 'file_path'): string {
  if (toolInput && typeof toolInput === 'object' && field in toolInput) {
    return asString((toolInput as Record<string, unknown>)[field]);
  }
  return '';
}

function extractShellCommand(data: Record<string, unknown>): string {
  const direct = asString(data['command']);
  if (direct) return direct;
  const toolInput = data['tool_input'] ?? data['toolInput'];
  return toolInputField(toolInput, 'command');
}

function resolveCwd(data: Record<string, unknown>): string {
  const cwd = asString(data['cwd']);
  if (cwd) return cwd;
  const roots = data['workspace_roots'];
  if (Array.isArray(roots) && typeof roots[0] === 'string') return roots[0];
  return process.cwd();
}

export function isShellTool(toolName?: string): boolean {
  return /^(bash|shell)$/i.test(toolName ?? '');
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
    const toolInput = data['tool_input'] ?? data['toolInput'];
    const mergedCommand = command || toolInputField(toolInput, 'command');
    let tool_name = asString(data['tool_name']);
    if (!tool_name) tool_name = asString(data['toolName']);
    if (!tool_name && (isBeforeShell || command)) tool_name = 'Shell';
    return {
      tool_name,
      tool_input: { command: mergedCommand },
      session_id: asString(data['session_id']) || asString(data['conversation_id']),
      cwd: resolveCwd(data),
    };
  }
  if (platform === 'kiro') {
    const toolInput = data['tool_input'] ?? data['toolInput'];
    let tool_name = asString(data['tool_name']);
    if (!tool_name) tool_name = asString(data['toolName']);
    return {
      tool_name,
      tool_input:
        toolInput && typeof toolInput === 'object'
          ? {
              command: toolInputField(toolInput, 'command'),
              file_path: toolInputField(toolInput, 'file_path'),
            }
          : {},
      session_id: asString(data['session_id']) || asString(data['sessionId']),
      cwd: resolveCwd(data),
    };
  }
  const toolInput = data['tool_input'];
  return {
    tool_name: asString(data['tool_name']),
    tool_input:
      toolInput && typeof toolInput === 'object'
        ? {
            command: toolInputField(toolInput, 'command'),
            file_path: toolInputField(toolInput, 'file_path'),
          }
        : {},
    session_id: asString(data['session_id']),
    cwd: resolveCwd(data),
  };
}

export async function readHookInput(): Promise<HookInput> {
  const raw = await readStdinBase();
  return normalizeInput(raw);
}

export function isFileEditTool(toolName?: string): boolean {
  return /^(edit|write)$/i.test(toolName ?? '');
}

function parseHookToolInput(rawInput: unknown): HookToolInput {
  const tool_input: HookToolInput = {};
  if (!rawInput || typeof rawInput !== 'object') return tool_input;
  const obj = rawInput as Record<string, unknown>;
  if ('command' in obj) tool_input.command = asString(obj['command']);
  if ('file_path' in obj) tool_input.file_path = asString(obj['file_path']);
  if ('content' in obj) tool_input.content = asString(obj['content']);
  if ('new_string' in obj) tool_input.new_string = asString(obj['new_string']);
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
  const rawInput = data['tool_input'] ?? data['toolInput'];
  const tool_input = parseHookToolInput(rawInput);
  let tool_name = asString(data['tool_name']);
  if (!tool_name) tool_name = asString(data['toolName']);
  return {
    tool_name,
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
      hookEventName: hookEvent,
      additionalContext: message,
    },
  });
}
