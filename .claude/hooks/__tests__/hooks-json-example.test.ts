import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from './helpers.js';

interface HooksManifest {
  version: number;
  requiredEvents: string[];
  requiredCommandTokens: string[];
  requiredSymlinks: { path: string; targetSuffix: string }[];
  yingmiAssets: string[];
  gitRestoreRef: string;
}

interface HooksJsonExample {
  hooks: Record<string, unknown[]>;
}

describe('hooks-json-example', () => {
  const manifestPath = join(PROJECT_ROOT, '.cursor', 'hooks-manifest.json');
  const hooksJsonPath = join(PROJECT_ROOT, '.cursor', 'hooks.json.example');

  it('manifest 与 hooks.json.example 存在', () => {
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(hooksJsonPath)).toBe(true);
  });

  it('requiredCommandTokens 均出现在 hooks.json.example 中', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as HooksManifest;
    const content = readFileSync(hooksJsonPath, 'utf-8');
    for (const token of manifest.requiredCommandTokens) {
      expect(content).toContain(token);
    }
  });

  it('requiredEvents 在 hooks.json.example 中均有 hook 条目', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as HooksManifest;
    const hooksJson = JSON.parse(readFileSync(hooksJsonPath, 'utf-8')) as HooksJsonExample;
    for (const event of manifest.requiredEvents) {
      const entries = hooksJson.hooks[event];
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
    }
  });

  it('manifest 含 gitRestoreRef 与 requiredSymlinks', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as HooksManifest;
    expect(manifest.gitRestoreRef).toBe('HEAD:.cursor/hooks.json.example');
    expect(manifest.requiredSymlinks.length).toBeGreaterThan(0);
    expect(manifest.yingmiAssets.length).toBe(5);
  });
});
