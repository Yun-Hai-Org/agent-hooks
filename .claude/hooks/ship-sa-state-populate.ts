#!/usr/bin/env bun
import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, readStdin } from './security-orchestrator.js';
import { asString } from './types.js';
import { isGateNodeEnabled } from './gate-config.js';
import { loadWorkflowState, saveWorkflowState } from './workflow-state.js';

const HOOK_NAME = 'ship-sa-state-populate';
const SHIP_ROLE_PATTERN = /ship-sa|integrator-sa|merge-sa|ci-fixer-sa/;
const NL = String.fromCharCode(10);

function log(data: any) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, new Date().toISOString().slice(0, 10) + '.jsonl');
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: HOOK_NAME, ...data }) + NL);
  } catch (e) {}
}

function emit(out: string) {
  process.stdout.write(out + NL);
}

function extractAgentId(toolResponse: unknown): string {
  if (!toolResponse) return '';
  const text = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);
  const m = text.match(/Agent ID: *([0-9a-f-]{8,})/i);
  if (m) return m[1];
  if (typeof toolResponse === 'object' && toolResponse) {
    const obj = toolResponse as any;
    for (const key of ['agent_id', 'agentId', 'id', 'task_id']) {
      const v = asString(obj[key]);
      if (v) return v;
    }
  }
  return '';
}

function detectShipRole(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const obj = toolInput as any;
  const desc = asString(obj['description']) || asString(obj['subagent_description']);
  const type = asString(obj['subagent_type']) || asString(obj['agent_type']);
  const prompt = asString(obj['prompt']);
  const combined = (desc + ' ' + type + ' ' + prompt).toLowerCase();
  const m = combined.match(/(ship-sa|integrator-sa|merge-sa|ci-fixer-sa)/);
  return m ? m[1] : '';
}

async function main() {
  try {
    const raw = await readStdin();
    const cwd = asString(raw['cwd']) || (Array.isArray(raw['workspace_roots']) && typeof raw['workspace_roots'][0] === 'string' ? raw['workspace_roots'][0] : process.cwd());

    if (!isGateNodeEnabled('ide.git-ship-gate', cwd)) {
      emit('{}');
      return;
    }

    const toolName = asString(raw['tool_name']) || asString(raw['toolName']);
    if (!/^task$/i.test(toolName)) {
      emit('{}');
      return;
    }

    const toolInput = raw['tool_input'] ?? raw['toolInput'];
    const role = detectShipRole(toolInput);
    if (!role) {
      emit('{}');
      return;
    }

    const toolResponse = raw['tool_response'] ?? raw['toolResponse'];
    const agentId = extractAgentId(toolResponse);
    if (!agentId) {
      log({ level: 'INFO', reason: 'no agent_id in Task response', role: role });
      emit('{}');
      return;
    }

    const state = loadWorkflowState(agentId);
    state.agent_role = role;
    const exists = state.active_background_tasks.some(function (t) { return t.agentId === agentId; });
    if (!exists) {
      state.active_background_tasks.push({
        agentId: agentId,
        runInBackground: true,
        startedAt: new Date().toISOString(),
      });
    }
    saveWorkflowState(agentId, state);
    log({ level: 'INFO', reason: 'populated ship-sa state', agent_id: agentId, role: role });
    emit('{}');
  } catch (e: unknown) {
    log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    emit('{}');
  }
}

if (import.meta.main) {
  void main();
}

export { HOOK_NAME, main };
