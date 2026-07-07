import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { LOG_DIR } from './security-orchestrator.js';
import type { GatePendingEntry, GatePendingType } from './types.js';

const PENDING_FILE = join(LOG_DIR, 'gate-pending.json');

function readStore(): Record<string, GatePendingEntry> {
  try {
    if (!existsSync(PENDING_FILE)) return {};
    return JSON.parse(readFileSync(PENDING_FILE, 'utf8')) as Record<string, GatePendingEntry>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, GatePendingEntry>): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(PENDING_FILE, JSON.stringify(store, null, 2));
}

export function makeCwdPendingKey(entry: GatePendingEntry): string {
  const hash = createHash('sha256').update(`${entry.type}:${entry.cwd}`).digest('hex').slice(0, 16);
  return `cwd:${hash}`;
}

export function setPendingGateFailure(sessionId: string, entry: GatePendingEntry): void {
  const store = readStore();
  const record: GatePendingEntry = { ...entry, ts: Date.now() };
  const key = sessionId || makeCwdPendingKey(entry);
  store[key] = record;
  if (sessionId) {
    store[makeCwdPendingKey(entry)] = record;
  }
  writeStore(store);
}

export function getPendingGateFailure(sessionId: string, cwd?: string): GatePendingEntry | null {
  const store = readStore();
  if (sessionId && store[sessionId]) return store[sessionId];
  if (cwd) {
    for (const type of ['push', 'merge'] as GatePendingType[]) {
      const key = makeCwdPendingKey({ type, command: '', cwd });
      if (store[key]) return store[key];
    }
  }
  return null;
}

export function clearPendingGateFailure(sessionId: string, cwd?: string): void {
  const store = readStore();
  const keysToRemove = new Set<string>();
  if (sessionId && sessionId in store) {
    keysToRemove.add(sessionId);
  }
  if (cwd) {
    for (const type of ['push', 'merge'] as GatePendingType[]) {
      keysToRemove.add(makeCwdPendingKey({ type, command: '', cwd }));
    }
  }
  if (keysToRemove.size === 0) return;

  const nextStore: Record<string, GatePendingEntry> = {};
  for (const [key, value] of Object.entries(store)) {
    if (!keysToRemove.has(key)) {
      nextStore[key] = value;
    }
  }
  writeStore(nextStore);
}
