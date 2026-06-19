import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
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
 * @param {string} sessionId
 * @param {GatePendingEntry} entry
 */
export function setPendingGateFailure(sessionId, entry) {
  if (!sessionId) return;
  const store = readStore();
  store[sessionId] = { ...entry, ts: Date.now() };
  writeStore(store);
}

/** @param {string} sessionId */
export function getPendingGateFailure(sessionId) {
  if (!sessionId) return null;
  const store = readStore();
  return store[sessionId] || null;
}

/** @param {string} sessionId */
export function clearPendingGateFailure(sessionId) {
  if (!sessionId) return;
  const store = readStore();
  if (!store[sessionId]) return;
  delete store[sessionId];
  writeStore(store);
}
