import { describe, it, expect } from 'bun:test';
import { classifyFormatOnWriteTarget, formatFileOnWrite } from '../checks/format-on-write.js';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PROJECT_ROOT } from './helpers.js';

describe('format-on-write', () => {
  describe('classifyFormatOnWriteTarget', () => {
    it('应对 prettier 扩展名返回 prettier', () => {
      expect(classifyFormatOnWriteTarget('src/app.ts')).toEqual({
        prettier: true,
        markdownlint: false,
        ruff: false,
        shfmt: false,
        taplo: false,
      });
    });

    it('应对 md 同时启用 prettier 与 markdownlint', () => {
      expect(classifyFormatOnWriteTarget('README.md')).toEqual({
        prettier: true,
        markdownlint: true,
        ruff: false,
        shfmt: false,
        taplo: false,
      });
    });

    it('应对 py/sh/toml 路由到对应工具', () => {
      expect(classifyFormatOnWriteTarget('main.py').ruff).toBe(true);
      expect(classifyFormatOnWriteTarget('script.sh').shfmt).toBe(true);
      expect(classifyFormatOnWriteTarget('Cargo.toml').taplo).toBe(true);
    });

    it('应跳过 bun.lock', () => {
      expect(classifyFormatOnWriteTarget('bun.lock').prettier).toBe(false);
    });

    it('未知扩展名应全部 false', () => {
      expect(classifyFormatOnWriteTarget('image.png')).toEqual({
        prettier: false,
        markdownlint: false,
        ruff: false,
        shfmt: false,
        taplo: false,
      });
    });
  });

  describe('formatFileOnWrite', () => {
    it('文件不存在时应 skipped', async () => {
      const result = await formatFileOnWrite('/no/such/file.ts');
      expect(result.formatted).toBe(false);
      expect(result.skipped).toContain('file-missing');
    });

    it('不支持扩展名时应 skipped', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'format-on-write-'));
      try {
        const file = join(dir, 'note.txt');
        writeFileSync(file, 'hello');
        const result = await formatFileOnWrite(file, dir);
        expect(result.formatted).toBe(false);
        expect(result.skipped).toContain('unsupported-extension');
      } finally {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }
    });

    it('ts 文件应尝试 prettier 路径', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'format-on-write-'));
      try {
        const file = join(dir, 'sample.ts');
        writeFileSync(file, 'const  x=1');
        const result = await formatFileOnWrite(file, PROJECT_ROOT);
        expect(result.skipped.includes('unsupported-extension')).toBe(false);
        expect(result.formatted || result.skipped.length > 0 || result.errors.length > 0).toBe(true);
      } finally {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    it('md 文件应走 markdownlint 或 prettier 路径', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'format-on-write-'));
      try {
        const file = join(dir, 'note.md');
        writeFileSync(file, '# Title\n\ncontent');
        const result = await formatFileOnWrite(file, PROJECT_ROOT);
        expect(result.skipped.includes('unsupported-extension')).toBe(false);
        expect(result.tools.length + result.skipped.length + result.errors.length).toBeGreaterThan(0);
      } finally {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }
    }, 90_000);

    it('空路径应 skipped', async () => {
      const result = await formatFileOnWrite('', PROJECT_ROOT);
      expect(result.skipped).toContain('file-missing');
    });
  });
});
