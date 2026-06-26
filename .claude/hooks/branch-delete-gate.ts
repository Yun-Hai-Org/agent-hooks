#!/usr/bin/env bun
/**
 * Branch Delete Gate - PreToolUse / beforeShellExecution Hook
 * 严格限制 AI 删除未 merge 进 main/master 的分支与 worktree
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, DECISION } from './security-orchestrator.js';
import { readHookInput, formatDenyOutput, formatAllowOutput, isShellHookInput } from './hook-adapter.js';
import { evaluateBranchDeleteCommand } from './checks/git-policy.js';
import { notifySecurityEventAsync } from './notify-security-event.js';

const HOOK_NAME = 'branch-delete-gate';

function log(data: Record<string, unknown>) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: HOOK_NAME, ...data }) + '\n');
  } catch {}
}

async function main() {
  try {
    const data = await readHookInput();
    const { tool_input, session_id, cwd } = data;
    const workingDir = cwd || process.cwd();

    if (!isShellHookInput(data)) {
      console.log(formatAllowOutput());
      return;
    }

    const cmd = tool_input.command ?? '';
    const result = evaluateBranchDeleteCommand(cmd, workingDir);

    if (result?.decision === DECISION.DENY) {
      log({
        level: 'BLOCKED',
        reason: result.message.slice(0, 200),
        cmd: cmd.slice(0, 200),
        session_id,
        cwd: workingDir,
      });
      notifySecurityEventAsync({
        hook: HOOK_NAME,
        severity: 'high',
        reason: result.message,
        session_id,
      });
      console.log(formatDenyOutput(DECISION.DENY, result.message));
      return;
    }

    console.log(formatAllowOutput());
  } catch (e) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    console.log(formatAllowOutput());
  }
}

if (import.meta.main) {
  void main();
}

export { main };
