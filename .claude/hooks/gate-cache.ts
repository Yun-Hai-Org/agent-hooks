import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execCommand, LOG_DIR } from './security-orchestrator.js';

const CACHE_FILE = join(LOG_DIR, 'gate-full-pass-cache.json');
// 缩短至 15 分钟：缩小"树未变但安全态势已变"（如新披露 CVE）窗口
const DEFAULT_TTL_MS = 15 * 60 * 1000;

interface FullPassEntry {
  tree: string;
  ts: number;
}

type FullPassStore = Record<string, FullPassEntry>;

function readStore(): FullPassStore {
  try {
    if (!existsSync(CACHE_FILE)) return {};
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as FullPassStore;
  } catch {
    return {};
  }
}

function writeStore(store: FullPassStore): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2));
}

export function makeFullPassCacheKey(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

export function getHeadTreeSha(cwd: string): string | null {
  const result = execCommand('git rev-parse HEAD^{tree}', { cwd, timeout: 5000 });
  if (!result.success || !result.stdout.trim()) return null;
  return result.stdout.trim();
}

export function getIndexTreeSha(cwd: string): string | null {
  const result = execCommand('git write-tree', { cwd, timeout: 5000 });
  if (!result.success || !result.stdout.trim()) return null;
  return result.stdout.trim();
}

export function recordFullPass(cwd: string, tree: string): void {
  const store = readStore();
  store[makeFullPassCacheKey(cwd)] = { tree, ts: Date.now() };
  writeStore(store);
}

export function hasFreshFullPass(cwd: string, tree: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const store = readStore();
  const entry = store[makeFullPassCacheKey(cwd)];
  if (!entry) return false;
  if (entry.tree !== tree) return false;
  return Date.now() - entry.ts <= ttlMs;
}

export function clearFullPass(cwd: string): void {
  const store = readStore();
  const key = makeFullPassCacheKey(cwd);
  if (!(key in store)) return;
  const next: FullPassStore = {};
  for (const [k, v] of Object.entries(store)) {
    if (k !== key) next[k] = v;
  }
  writeStore(next);
}
