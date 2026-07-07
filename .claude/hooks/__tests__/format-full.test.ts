import { describe, it, expect } from 'bun:test';
import {
  isPrettierFullTarget,
  chunkPrettierFiles,
  PRETTIER_FULL_BATCH_SIZE,
  PRETTIER_FULL_TIMEOUT_MS,
} from '../checks/format-full.js';

describe('format-full', () => {
  describe('isPrettierFullTarget', () => {
    it('应匹配常见 prettier 扩展名', () => {
      expect(isPrettierFullTarget('src/app.ts')).toBe(true);
      expect(isPrettierFullTarget('_bmad-output/planning/prd.md')).toBe(true);
    });

    it('应排除 lock 文件', () => {
      expect(isPrettierFullTarget('bun.lock')).toBe(false);
      expect(isPrettierFullTarget('pnpm-lock.yaml')).toBe(true);
    });

    it('非 prettier 扩展名应 false', () => {
      expect(isPrettierFullTarget('image.png')).toBe(false);
    });
  });

  describe('chunkPrettierFiles', () => {
    it('小列表应单批', () => {
      expect(chunkPrettierFiles(['a.ts', 'b.ts'])).toEqual([['a.ts', 'b.ts']]);
    });

    it('超过 batchSize 应分批', () => {
      const files = Array.from({ length: PRETTIER_FULL_BATCH_SIZE + 1 }, (_, i) => `f${i}.ts`);
      const batches = chunkPrettierFiles(files);
      expect(batches).toHaveLength(2);
      expect(batches[0]).toHaveLength(PRETTIER_FULL_BATCH_SIZE);
      expect(batches[1]).toHaveLength(1);
    });
  });

  it('prettier 超时应为 300s', () => {
    expect(PRETTIER_FULL_TIMEOUT_MS).toBe(300000);
  });
});
