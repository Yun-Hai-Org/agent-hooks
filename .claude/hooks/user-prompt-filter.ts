#!/usr/bin/env bun
/**
 * User Prompt Filter - UserPromptSubmit Hook
 * Scans user prompt input for sensitive information (API keys, passwords, etc.)
 * Blocks submission when secrets are detected; fail-open on errors.
 * Logs to: ~/.claude/hooks-logs/
 */

import { CONTENT_PATTERNS } from './protect-secrets.js';
import { readStdin, log, safeMain } from './security-orchestrator.js';

const HOOK_NAME = 'user-prompt-filter';

/**
 * Scan prompt text for sensitive content patterns.
 * @param {string} prompt - User input text to scan
 * @returns {{ blocked: boolean, pattern: { id: string, level: string, reason: string } | null }}
 */
export function scanPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return { blocked: false, pattern: null };
  for (const p of CONTENT_PATTERNS) {
    if (p.regex.test(prompt)) {
      return { blocked: true, pattern: p };
    }
  }
  return { blocked: false, pattern: null };
}

async function main() {
  const data = await readStdin();
  const tool_input = data.tool_input as { user_prompt?: string } | undefined;
  const session_id = String(data.session_id || '');
  const cwd = String(data.cwd || process.cwd());

  // Only process UserPromptSubmit events
  if (data?.tool_name !== 'UserPromptSubmit') {
    return console.log('{}');
  }

  const prompt = tool_input?.user_prompt || '';
  const result = scanPrompt(prompt);

  if (result.blocked && result.pattern) {
    const p = result.pattern;
    log(HOOK_NAME, {
      level: 'BLOCKED',
      id: p.id,
      priority: p.level,
      session_id,
      cwd,
      promptLength: prompt.length,
    });

    return console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          permissionDecision: 'deny',
          permissionDecisionReason: `🛡️ [user-prompt-filter] 提示中含有敏感信息（${p.reason}），已阻止`,
        },
      }),
    );
  }

  console.log('{}');
}

// Only call main() when run directly, not when imported
if (import.meta.main) {
  safeMain(main);
}
