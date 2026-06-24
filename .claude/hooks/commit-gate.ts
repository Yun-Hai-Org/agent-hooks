#!/usr/bin/env bun
/**
 * Commit Gate - PreToolUse Hook for Bash
 * 提交门：git commit 前跑 quality-gate --profile=commit
 */

import { safeMain, DECISION } from './security-orchestrator.js';
import { readHookInput, formatDenyOutput, formatAllowOutput, isShellHookInput } from './hook-adapter.js';
import { isGitCommitCommand } from './checks/git-policy.js';
import { runQualityGate, logGateResult } from './quality-gate.js';

const HOOK_NAME = 'commit-gate';

/**
 *
 */
async function main() {
  await safeMain(async () => {
    const data = await readHookInput();
    const { tool_input, session_id, cwd } = data;

    if (!isShellHookInput(data)) {
      console.log(formatAllowOutput());
      return;
    }

    const cmd = tool_input.command ?? '';
    if (!isGitCommitCommand(cmd)) {
      console.log(formatAllowOutput());
      return;
    }

    const gateResult = await runQualityGate({ profile: 'commit', cwd, commitCmd: cmd });

    logGateResult(HOOK_NAME, gateResult, { profile: 'commit', session_id, cwd });

    if (!gateResult.passed) {
      console.log(formatDenyOutput(DECISION.DENY, `🚫 提交门未通过:\n${gateResult.decision.reason ?? ''}`));
      return;
    }

    console.log(formatAllowOutput());
  });
}

if (import.meta.main) {
  void main();
}

export { main };
