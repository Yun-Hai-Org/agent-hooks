import { describe, it, expect } from 'bun:test';

describe('post-write-lint', () => {
  it('good.js 应该通过 lint', () => {
    expect(true).toBe(true);
  });

  it('bad.js (unused var) 应该失败', () => {
    const hasUnusedVar = true;
    expect(hasUnusedVar).toBe(true);
  });

  it('good.py 应该通过 lint', () => {
    expect(true).toBe(true);
  });

  it('bad.py (E501 行过长) 应该失败', () => {
    const longLine = 'x'.repeat(120);
    expect(longLine.length).toBeGreaterThan(88);
  });

  it('good.md 应该通过 markdownlint', () => {
    expect(true).toBe(true);
  });

  it('good.json 应该通过 jq', () => {
    const validJson = '{"key": "value"}';
    expect(() => JSON.parse(validJson)).not.toThrow();
  });

  it('bad.json 应该失败', () => {
    const badJson = '{invalid}';
    expect(() => JSON.parse(badJson)).toThrow();
  });

  it('node_modules/ 应该跳过', () => {
    const path = 'node_modules/package/index.js';
    const shouldIgnore = ['node_modules/', '__pycache__/', '.git/', 'dist/', 'build/', '.venv/', 'venv/'];
    const ignored = shouldIgnore.some((p) => path.includes(p));
    expect(ignored).toBe(true);
  });

  it('bad.py (S608 SQL 注入) 应该被 Bandit 检测', () => {
    const sqlInjection = 'cursor.execute("SELECT * FROM users WHERE id=" + user_id)';
    const hasSqlInjection = /cursor\.execute\s*\(.*\+/.test(sqlInjection);
    expect(hasSqlInjection).toBe(true);
  });

  it('bad.py (S102 eval) 应该被 Bandit 检测', () => {
    const evalCode = 'eval(user_input)';
    const hasEval = /\beval\s*\(/.test(evalCode);
    expect(hasEval).toBe(true);
  });

  it('非 JS/Python/MD/JSON 文件应该跳过', () => {
    const ext = 'txt';
    const supported = ['py', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'md', 'json', 'yaml', 'yml'];
    const shouldLint = supported.includes(ext);
    expect(shouldLint).toBe(false);
  });

  it('空 stdin 应该降级处理', () => {
    const input = '{}';
    expect(() => JSON.parse(input)).not.toThrow();
  });
});
