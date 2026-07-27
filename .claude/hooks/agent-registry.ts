#!/usr/bin/env bun
/**
 * Global agent_id-keyed ownership registry.
 * Stored at ~/.claude/agent-registry/<sanitized_agent_id>.json
 * One file per agent_id; atomic write via tmp + fs.renameSync (same-volume POSIX atomic).
 * Fail-open: every public function catches and returns null/0/[] — never throws.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type AgentTaskKind = 'explore' | 'impl' | 'ship' | 'other';
export type AgentTaskStatus = 'dispatched' | 'running' | 'completed' | 'failed' | 'reclaimed';

export interface AgentRegistryEntry {
  agent_id: string;
  dispatcherSessionId: string;
  todoId?: string;
  kind: AgentTaskKind;
  status: AgentTaskStatus;
  startedAt: string;
  completedAt?: string;
  commitSha?: string;
  worktree?: string;
  agent_role?: string;
}

function getRegistryDir(): string {
  const home = process.env['HOME'] ?? homedir();
  return join(home, '.claude', 'agent-registry');
}

export function getRegistryPath(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  return join(getRegistryDir(), `${safe}.json`);
}

export function loadEntry(agentId: string): AgentRegistryEntry | null {
  try {
    const path = getRegistryPath(agentId);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AgentRegistryEntry>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.agent_id !== 'string' || !parsed.agent_id) return null;
    return parsed as AgentRegistryEntry;
  } catch {
    return null;
  }
}

export function saveEntry(entry: AgentRegistryEntry): void {
  let tmpPath: string | null = null;
  try {
    const dir = getRegistryDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const finalPath = getRegistryPath(entry.agent_id);
    tmpPath = `${finalPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(entry, null, 2), 'utf8');
    renameSync(tmpPath, finalPath);
    tmpPath = null;
  } catch {
    // fail-open
  } finally {
    if (tmpPath) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

export function updateEntry(agentId: string, patch: Partial<AgentRegistryEntry>): AgentRegistryEntry | null {
  const existing = loadEntry(agentId);
  if (!existing) return null;
  const merged: AgentRegistryEntry = { ...existing, ...patch, agent_id: existing.agent_id };
  saveEntry(merged);
  return merged;
}

export function listEntriesByDispatcher(sessionId: string): AgentRegistryEntry[] {
  try {
    const dir = getRegistryDir();
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir);
    const result: AgentRegistryEntry[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Partial<AgentRegistryEntry>;
        if (parsed && typeof parsed === 'object' && parsed.dispatcherSessionId === sessionId) {
          result.push(parsed as AgentRegistryEntry);
        }
      } catch {
        // skip corrupt file
      }
    }
    return result;
  } catch {
    return [];
  }
}

export function reapStale(maxAgeMs = 24 * 60 * 60 * 1000): number {
  try {
    const dir = getRegistryDir();
    if (!existsSync(dir)) return 0;
    const files = readdirSync(dir);
    const now = Date.now();
    let removed = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fullPath = join(dir, file);
      try {
        const parsed = JSON.parse(readFileSync(fullPath, 'utf8')) as Partial<AgentRegistryEntry>;
        if (!parsed || typeof parsed !== 'object') continue;
        const ts = parsed.completedAt ?? parsed.startedAt;
        if (!ts) continue;
        const age = now - new Date(ts).getTime();
        if (age > maxAgeMs) {
          unlinkSync(fullPath);
          removed++;
        }
      } catch {
        // skip
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
