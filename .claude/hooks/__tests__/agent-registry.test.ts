import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import {
  getRegistryPath,
  loadEntry,
  saveEntry,
  updateEntry,
  listEntriesByDispatcher,
  reapStale,
  type AgentRegistryEntry,
} from '../agent-registry.js';

const MODULE_PATH = join(import.meta.dir, '..', 'agent-registry.ts');

function makeEntry(agentId: string, dispatcher: string, status: AgentRegistryEntry['status'] = 'dispatched'): AgentRegistryEntry {
  return {
    agent_id: agentId,
    dispatcherSessionId: dispatcher,
    kind: 'impl',
    status,
    startedAt: new Date().toISOString(),
  };
}

function runChild(argv: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

describe('agent-registry', () => {
  let tempHome: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), `agent-reg-${Date.now()}-`));
    savedHome = process.env['HOME'];
    process.env['HOME'] = tempHome;
  });

  afterEach(() => {
    process.env['HOME'] = savedHome;
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('getRegistryPath sanitizes agent_id, blocking .. and / traversal', () => {
    const dir = join(tempHome, '.claude', 'agent-registry');
    // `..` collapses to underscores — never escapes the registry dir
    expect(getRegistryPath('..')).toBe(join(dir, '__.json'));
    expect(getRegistryPath('..')).not.toContain('..');
    // `/` separators are neutralized — flat filename only
    expect(getRegistryPath('a/b')).toBe(join(dir, 'a_b.json'));
    expect(getRegistryPath('a/b')).not.toMatch(/\/a\/b\.json$/);
    // path traversal payload stays inside the registry dir
    const hostile = getRegistryPath('../etc/passwd');
    expect(hostile.startsWith(dir + '/')).toBe(true);
    expect(hostile).not.toContain('/etc/passwd');
    // empty id falls back to default; all-hostile id collapses to underscores (still safe)
    expect(getRegistryPath('')).toBe(join(dir, 'default.json'));
    expect(getRegistryPath('///')).toBe(join(dir, '___.json'));
  });

  it('saveEntry writes valid JSON via atomic rename and leaves no .tmp files', () => {
    const entry = makeEntry('agent-1', 'sess-A');
    saveEntry(entry);
    const path = getRegistryPath('agent-1');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.agent_id).toBe('agent-1');
    expect(parsed.dispatcherSessionId).toBe('sess-A');
    const dir = join(tempHome, '.claude', 'agent-registry');
    const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toHaveLength(0);
  });

  it('concurrent saveEntry to the same agent_id yields no half-JSON', async () => {
    const agentId = 'racy-agent';
    const writers = 4;
    const writesEach = 60;
    const tasks: Promise<{ code: number | null; stdout: string; stderr: string }>[] = [];
    for (let w = 0; w < writers; w++) {
      const script = [
        `process.env.HOME=${JSON.stringify(tempHome)};`,
        `const m=await import(${JSON.stringify(MODULE_PATH)});`,
        `for(let i=0;i<${writesEach};i++){m.saveEntry({agent_id:${JSON.stringify(agentId)},dispatcherSessionId:'s',kind:'impl',status:'running',startedAt:new Date().toISOString(),commitSha:'sha-w'+${w}+'-i'+i});}`,
      ].join('');
      tasks.push(runChild(['-e', script]));
    }
    const results = await Promise.all(tasks);
    for (const r of results) expect(r.code).toBe(0);

    // final on-disk file must be complete valid JSON (no half-write)
    const path = getRegistryPath(agentId);
    expect(existsSync(path)).toBe(true);
    const final = JSON.parse(readFileSync(path, 'utf8'));
    expect(final.agent_id).toBe(agentId);
    expect(typeof final.commitSha).toBe('string');
    // no orphaned temp files
    const dir = join(tempHome, '.claude', 'agent-registry');
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
    // loadEntry agrees
    expect(loadEntry(agentId)?.agent_id).toBe(agentId);
  });

  it('concurrent saveEntry to distinct agent_ids all land as valid JSON', async () => {
    const n = 40;
    const tasks: Promise<{ code: number | null; stdout: string; stderr: string }>[] = [];
    for (let i = 0; i < n; i++) {
      const id = `dist-${i}`;
      const script = [
        `process.env.HOME=${JSON.stringify(tempHome)};`,
        `const m=await import(${JSON.stringify(MODULE_PATH)});`,
        `m.saveEntry({agent_id:${JSON.stringify(id)},dispatcherSessionId:'s',kind:'impl',status:'dispatched',startedAt:new Date().toISOString()});`,
      ].join('');
      tasks.push(runChild(['-e', script]));
    }
    const results = await Promise.all(tasks);
    for (const r of results) expect(r.code).toBe(0);
    const dir = join(tempHome, '.claude', 'agent-registry');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(n);
    for (const f of files) expect(() => JSON.parse(readFileSync(join(dir, f), 'utf8'))).not.toThrow();
  });

  it('loadEntry returns null for missing or corrupt entries (fail-open)', () => {
    expect(loadEntry('nope')).toBeNull();
    const dir = join(tempHome, '.claude', 'agent-registry');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), '{not valid json', 'utf8');
    expect(loadEntry('bad')).toBeNull();
    writeFileSync(join(dir, 'nokey.json'), '{"foo":"bar"}', 'utf8');
    expect(loadEntry('nokey')).toBeNull();
  });

  it('updateEntry merges patch, saves, and preserves agent_id key', () => {
    saveEntry(makeEntry('agent-u', 'sess-A', 'dispatched'));
    const updated = updateEntry('agent-u', { status: 'completed', completedAt: '2026-01-01T00:00:00Z', commitSha: 'abc' });
    expect(updated?.status).toBe('completed');
    expect(updated?.commitSha).toBe('abc');
    expect(updated?.agent_id).toBe('agent-u');
    expect(loadEntry('agent-u')?.status).toBe('completed');
    expect(updateEntry('missing', { status: 'failed' })).toBeNull();
  });

  it('listEntriesByDispatcher returns only that dispatcher entries', () => {
    saveEntry(makeEntry('a1', 'sess-A'));
    saveEntry(makeEntry('a2', 'sess-A'));
    saveEntry(makeEntry('b1', 'sess-B'));
    saveEntry(makeEntry('b2', 'sess-B'));
    saveEntry(makeEntry('b3', 'sess-B'));
    const a = listEntriesByDispatcher('sess-A');
    const b = listEntriesByDispatcher('sess-B');
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(3);
    expect(a.every((e) => e.dispatcherSessionId === 'sess-A')).toBe(true);
    expect(b.every((e) => e.dispatcherSessionId === 'sess-B')).toBe(true);
    expect(listEntriesByDispatcher('sess-Z')).toHaveLength(0);
  });

  it('reapStale drops entries older than 24h (by completedAt, fallback startedAt)', () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    saveEntry({ ...makeEntry('old-completed', 'sess-A', 'completed'), completedAt: old });
    saveEntry({ ...makeEntry('fresh-completed', 'sess-A', 'completed'), completedAt: fresh });
    // no completedAt → uses startedAt (old)
    saveEntry({ ...makeEntry('old-started-only', 'sess-A', 'dispatched'), startedAt: old });
    saveEntry({ ...makeEntry('fresh-started-only', 'sess-A', 'dispatched'), startedAt: fresh });

    const removed = reapStale();
    expect(removed).toBe(2);
    expect(loadEntry('old-completed')).toBeNull();
    expect(loadEntry('old-started-only')).toBeNull();
    expect(loadEntry('fresh-completed')?.agent_id).toBe('fresh-completed');
    expect(loadEntry('fresh-started-only')?.agent_id).toBe('fresh-started-only');
  });

  it('reapStale respects custom maxAgeMs', () => {
    const slightlyOld = new Date(Date.now() - 1000).toISOString();
    saveEntry({ ...makeEntry('young', 'sess-A', 'completed'), completedAt: slightlyOld });
    expect(reapStale(500)).toBe(1);
    expect(loadEntry('young')).toBeNull();
    expect(reapStale(60 * 60 * 1000)).toBe(0);
  });
});
