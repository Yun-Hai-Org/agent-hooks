import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { persistPlatform, readPersistedPlatform } from '../platform-state.js';

const ORIG_HOME = process.env.HOME;
let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'platform-state-'));
  process.env.HOME = tempHome;
});

afterEach(() => {
  process.env.HOME = ORIG_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

describe('platform-state', () => {
  it('persist 后 read 应返回相同平台', () => {
    persistPlatform('cursor', '/tmp/proj-a');
    expect(readPersistedPlatform('/tmp/proj-a')).toBe('cursor');
  });

  it('不同 cwd 隔离存储', () => {
    persistPlatform('cursor', '/tmp/proj-a');
    persistPlatform('kiro', '/tmp/proj-b');
    expect(readPersistedPlatform('/tmp/proj-a')).toBe('cursor');
    expect(readPersistedPlatform('/tmp/proj-b')).toBe('kiro');
  });

  it('未持久化的 cwd 返回 undefined', () => {
    expect(readPersistedPlatform('/tmp/never')).toBeUndefined();
  });

  it('过期状态（ts 超过 7 天）返回 undefined', () => {
    persistPlatform('claude', '/tmp/proj-old');
    const slug = '/tmp/proj-old'.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    const dir = join(tempHome, '.claude', 'platform-state');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${slug}.json`);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    writeFileSync(path, JSON.stringify({ platform: 'claude', ts: eightDaysAgo }), 'utf8');
    expect(readPersistedPlatform('/tmp/proj-old')).toBeUndefined();
  });

  it('损坏的 JSON 文件返回 undefined（fail-open）', () => {
    const slug = '/tmp/proj-broken'.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    const dir = join(tempHome, '.claude', 'platform-state');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${slug}.json`);
    writeFileSync(path, 'not-json', 'utf8');
    expect(readPersistedPlatform('/tmp/proj-broken')).toBeUndefined();
  });

  it('未知 platform 值返回 undefined', () => {
    const slug = '/tmp/proj-unknown'.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    const dir = join(tempHome, '.claude', 'platform-state');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${slug}.json`);
    writeFileSync(path, JSON.stringify({ platform: 'unknown-ide', ts: Date.now() }), 'utf8');
    expect(readPersistedPlatform('/tmp/proj-unknown')).toBeUndefined();
  });

  it('persistPlatform 空 platform / 空 cwd 不写盘', () => {
    persistPlatform('claude', '');
    expect(readPersistedPlatform('')).toBeUndefined();
  });

  it('cwd 路径含特殊字符被 slug 化', () => {
    const weirdCwd = '/tmp/proj with spaces & slashes';
    persistPlatform('kiro', weirdCwd);
    expect(readPersistedPlatform(weirdCwd)).toBe('kiro');
  });
});
