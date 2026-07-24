#!/usr/bin/env bun
/**
 * Hook Adapter - 三平台 stdin/stdout 适配
 * HOOK_PLATFORM=claude|cursor|kiro
 */

import { readStdin as readStdinBase } from './security-orchestrator.js';
import { basename } from 'path';
import type { AgentMode, HookInput, HookPlatform, HookToolInput } from './types.js';
import { asString } from './types.js';
import type { SessionEndTrigger } from './gate-config.js';
import { isWorkflowActive, loadWorkflowState, type WorkflowState } from './workflow-state.js';

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

const VALID_AGENT_MODES: ReadonlySet<AgentMode> = new Set(['orchestrator', 'ask', 'subagent']);

function isValidAgentMode(value: unknown): value is AgentMode {
  return typeof value === 'string' && VALID_AGENT_MODES.has(value as AgentMode);
}

export function deriveAgentMode(raw: Record<string, unknown>, state: WorkflowState): AgentMode {
  const envMode = process.env['AGENT_MODE'];
  if (isValidAgentMode(envMode)) return envMode;
  if (isValidAgentMode(raw['agent_mode'])) return raw['agent_mode'] as AgentMode;
  if (asString(raw['agent_id'])) return 'subagent';
  return isWorkflowActive(state) ? 'orchestrator' : 'ask';
}

export function isOrchestratorInWorkflow(raw: Record<string, unknown>, state: WorkflowState): boolean {
  return deriveAgentMode(raw, state) === 'orchestrator';
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
    const sessionId = asString(data['session_id']) || asString(data['conversation_id']);
    const state = loadWorkflowState(sessionId);
    return {
      tool_name,
      tool_input: { command: mergedCommand },
      session_id: sessionId,
      cwd: resolveCwd(data),
      agent_id: asString(data['agent_id']),
      agent_mode: deriveAgentMode(data, state),
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
    const sessionId =
      typeof data['session_id'] === 'string'
        ? data['session_id']
        : typeof data['conversation_id'] === 'string'
          ? data['conversation_id']
          : '';
    const state = loadWorkflowState(sessionId);
    return {
      tool_name: 'Write',
      tool_input: { file_path: data['file_path'] },
      session_id: sessionId,
      cwd:
        typeof data['cwd'] === 'string'
          ? data['cwd']
          : Array.isArray(roots) && typeof roots[0] === 'string'
            ? roots[0]
            : process.cwd(),
      agent_id: asString(data['agent_id']),
      agent_mode: deriveAgentMode(data, state),
    };
  }
  const rawInput = data['tool_input'] ?? data['toolInput'];
  const tool_input = parseHookToolInput(rawInput);
  let tool_name = asString(data['tool_name']);
  if (!tool_name) tool_name = asString(data['toolName']);
  const sessionId =
    typeof data['session_id'] === 'string'
      ? data['session_id']
      : typeof data['conversation_id'] === 'string'
        ? data['conversation_id']
        : '';
  const state = loadWorkflowState(sessionId);
  return {
    tool_name,
    tool_input,
    session_id: sessionId,
    cwd: typeof data['cwd'] === 'string' ? data['cwd'] : process.cwd(),
    agent_id: asString(data['agent_id']),
    agent_mode: deriveAgentMode(data, state),
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

export interface ConversationEndInput {
  platform: HookPlatform;
  hookEvent: string;
  sessionId: string;
  cwd: string;
  projectName: string;
  summaryText: string;
  reason?: string;
  durationMs?: number;
  status?: string;
  transcriptPath?: string;
}

function resolveConversationCwd(data: Record<string, unknown>): string {
  const cwd = asString(data['cwd']);
  if (cwd) return cwd;
  const roots = data['workspace_roots'];
  if (Array.isArray(roots) && typeof roots[0] === 'string') return roots[0];
  return process.cwd();
}

export function resolveProjectName(data: Record<string, unknown>): string {
  const cwd = resolveConversationCwd(data);
  const roots = data['workspace_roots'];
  const root = Array.isArray(roots) && typeof roots[0] === 'string' ? roots[0] : cwd;
  return basename(root) || basename(cwd) || 'project';
}

function normalizeHookEventName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === 'sessionend' || lower === 'session_end') return 'SessionEnd';
  if (lower === 'stop') return 'Stop';
  if (lower === 'afteragentresponse') return 'afterAgentResponse';
  return trimmed;
}

export function extractAssistantText(data: Record<string, unknown>, platform: HookPlatform, hookEvent: string): string {
  const event = hookEvent.toLowerCase();
  if (platform === 'cursor') {
    if (event.includes('afteragent')) {
      return asString(data['text']) || asString(data['response']);
    }
    if (event === 'stop') {
      return asString(data['text']) || asString(data['last_assistant_message']);
    }
  }
  if (platform === 'claude') {
    if (event === 'stop' || event === 'subagentstop' || event === 'sessionend') {
      return asString(data['last_assistant_message']);
    }
  }
  if (platform === 'kiro') {
    if (event === 'stop') {
      return asString(data['assistant_response']) || asString(data['last_assistant_message']);
    }
  }
  return '';
}

export function parseConversationEndInput(data: Record<string, unknown>): ConversationEndInput {
  const platform = getPlatform();
  const hookEvent = normalizeHookEventName(asString(data['hook_event_name']));
  const sessionId = asString(data['session_id']) || asString(data['conversation_id']) || asString(data['sessionId']);
  const cwd = resolveConversationCwd(data);
  const summaryText = extractAssistantText(data, platform, hookEvent);
  const durationRaw = data['duration_ms'] ?? data['durationMs'];
  const durationMs = typeof durationRaw === 'number' ? durationRaw : undefined;
  const input: ConversationEndInput = {
    platform,
    hookEvent,
    sessionId,
    cwd,
    projectName: resolveProjectName(data),
    summaryText,
  };
  const reason = asString(data['reason']);
  if (reason) input.reason = reason;
  const status = asString(data['status']);
  if (status) input.status = status;
  if (durationMs !== undefined) input.durationMs = durationMs;
  const transcriptPath = asString(data['transcript_path']);
  if (transcriptPath) input.transcriptPath = transcriptPath;
  return input;
}

const PLATFORM_LABELS: Record<HookPlatform, string> = {
  cursor: 'Cursor',
  claude: 'Claude Code',
  kiro: 'Kiro',
};

export function platformLabel(platform: HookPlatform): string {
  return PLATFORM_LABELS[platform];
}

export function formatTriggerLabel(trigger: SessionEndTrigger, platform: HookPlatform): string {
  switch (trigger) {
    case 'session_end':
      return '会话结束';
    case 'stop':
      return platform === 'kiro' ? '每轮结束（Kiro 无 sessionEnd）' : '每轮结束';
    case 'both':
      return '会话结束/每轮结束';
    default: {
      const _exhaustive: never = trigger;
      return _exhaustive;
    }
  }
}

export function isSessionEndHookEvent(hookEvent: string): boolean {
  return hookEvent.replace(/_/g, '').toLowerCase() === 'sessionend';
}

export function isStopHookEvent(hookEvent: string): boolean {
  return hookEvent.toLowerCase() === 'stop';
}

export function shouldNotifyForTrigger(trigger: SessionEndTrigger, hookEvent: string): boolean {
  const sessionEnd = isSessionEndHookEvent(hookEvent);
  const stop = isStopHookEvent(hookEvent);
  switch (trigger) {
    case 'both':
      return sessionEnd || stop;
    case 'session_end':
      return sessionEnd;
    case 'stop':
      return stop;
    default: {
      const _exhaustive: never = trigger;
      return _exhaustive;
    }
  }
}
