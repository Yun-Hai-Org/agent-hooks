import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { LOG_DIR } from './security-orchestrator.js';

const PENDING_FILE = join(LOG_DIR, 'gate-pending.json');

/** @typedef {'push' | 'merge'} GatePendingType */

/**
 * @typedef {Object} GatePendingEntry
 * @property {GatePendingType} type
 * @property {string} command
 * @property {string} cwd
 * @property {string} [sourceBranch]
 * @property {number} ts
 */

function readStore() {
  try {
    if (!existsSync(PENDING_FILE)) return {};
    return JSON.parse(readFileSync(PENDING_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(PENDING_FILE, JSON.stringify(store, null, 2));
}

/**
 * @param {GatePendingEntry} entry
 */
export function makeCwdPendingKey(entry) {
  const hash = createHash('sha256').update(`${entry.type}:${entry.cwd}`).digest('hex').slice(0, 16);
  return `cwd:${hash}`;
}

/**
 * @param {string} sessionId
 * @param {GatePendingEntry} entry
 */
export function setPendingGateFailure(sessionId, entry) {
  const store = readStore();
  const record = { ...entry, ts: Date.now() };
  const key = sessionId || makeCwdPendingKey(entry);
  store[key] = record;
  if (sessionId) {
    store[makeCwdPendingKey(entry)] = record;
  }
  writeStore(store);
}

/** @param {string} sessionId @param {string} [cwd] */
export function getPendingGateFailure(sessionId, cwd) {
  const store = readStore();
  if (sessionId && store[sessionId]) return store[sessionId];
  if (cwd) {
    for (const type of /** @type {GatePendingType[]} */ (['push', 'merge'])) {
      const key = makeCwdPendingKey({ type, command: '', cwd });
      if (store[key]) return store[key];
    }
  }
  return null;
}

/** @param {string} sessionId @param {string} [cwd] */
export function clearPendingGateFailure(sessionId, cwd) {
  const store = readStore();
  let changed = false;
  if (sessionId && store[sessionId]) {
    delete store[sessionId];
    changed = true;
  }
  if (cwd) {
    for (const type of /** @type {GatePendingType[]} */ (['push', 'merge'])) {
      const key = makeCwdPendingKey({ type, command: '', cwd });
      if (store[key]) {
        delete store[key];
        changed = true;
      }
    }
  }
  if (changed) writeStore(store);
}
