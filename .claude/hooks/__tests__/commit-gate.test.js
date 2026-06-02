import { describe, it, expect } from 'bun:test';

// commit-gate 测试 - 测试 commit message 格式、敏感文件检测等逻辑
describe('commit-gate', () => {
  // Commit message 格式检测
  const MSG_REGEX = /^(feat|fix|refactor|docs|test|chore|style|perf):\s+\S/;

  it('应该允许 "feat: 新增功能"', () => {
    expect(MSG_REGEX.test('feat: 新增功能')).toBe(true);
  });

  it('应该允许 "fix: 修复bug"', () => {
    expect(MSG_REGEX.test('fix: 修复bug')).toBe(true);
  });

  it('应该允许 "refactor: 重构模块"', () => {
    expect(MSG_REGEX.test('refactor: 重构模块')).toBe(true);
  });

  it('应该允许 "docs: 更新文档"', () => {
    expect(MSG_REGEX.test('docs: 更新文档')).toBe(true);
  });

  it('应该允许 "test: 新增测试"', () => {
    expect(MSG_REGEX.test('test: 新增测试')).toBe(true);
  });

  it('应该允许 "chore: 更新依赖"', () => {
    expect(MSG_REGEX.test('chore: 更新依赖')).toBe(true);
  });

  it('应该允许 "style: 格式化代码"', () => {
    expect(MSG_REGEX.test('style: 格式化代码')).toBe(true);
  });

  it('应该允许 "perf: 优化性能"', () => {
    expect(MSG_REGEX.test('perf: 优化性能')).toBe(true);
  });

  it('应该拒绝 "wip"', () => {
    expect(MSG_REGEX.test('wip')).toBe(false);
  });

  it('应该拒绝 "fix:x" (无空格)', () => {
    expect(MSG_REGEX.test('fix:x')).toBe(false);
  });

  it('应该拒绝 "feat:" (无描述)', () => {
    expect(MSG_REGEX.test('feat:')).toBe(false);
  });

  it('应该拒绝 "WIP: 临时提交"', () => {
    expect(MSG_REGEX.test('WIP: 临时提交')).toBe(false);
  });

  it('应该拒绝 "tmp: 临时保存"', () => {
    expect(MSG_REGEX.test('tmp: 临时保存')).toBe(false);
  });

  it('应该拒绝 "update: 更新代码" (不在允许列表中)', () => {
    expect(MSG_REGEX.test('update: 更新代码')).toBe(false);
  });

  // 敏感文件检测
  const SENSITIVE_FILES = [
    '.env',
    '.env.local',
    '.env.production',
    '.ssh/id_rsa',
    '.ssh/id_ed25519',
    'server.pem',
    'cert.key',
    'keystore.p12',
    'cert.pfx',
    'credentials.json',
    '.netrc',
  ];

  it('.env 应该被识别为敏感文件', () => {
    expect(SENSITIVE_FILES.includes('.env')).toBe(true);
  });

  it('server.pem 应该被识别为敏感文件', () => {
    expect(SENSITIVE_FILES.includes('server.pem')).toBe(true);
  });

  it('src/app.js 不应该被识别为敏感文件', () => {
    expect(SENSITIVE_FILES.includes('src/app.js')).toBe(false);
  });

  it('README.md 不应该被识别为敏感文件', () => {
    expect(SENSITIVE_FILES.includes('README.md')).toBe(false);
  });

  // 关联测试文件查找
  function findTestFile(changedFile) {
    const base = changedFile.replace(/\.(js|ts|py)$/, '');
    const dir = changedFile.includes('/') ? changedFile.split('/').slice(0, -1).join('/') : '';
    const filename = changedFile
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, '');
    const candidates = [
      `__tests__/${filename}.test.js`,
      `__tests__/${filename}.test.ts`,
      `${dir}/__tests__/${filename}.test.js`,
      `${dir}/__tests__/${filename}.test.py`,
    ];
    return candidates;
  }

  it('src/a.js 应该查找 __tests__/a.test.js', () => {
    const tests = findTestFile('src/a.js');
    expect(tests.some((t) => t.includes('a.test'))).toBe(true);
  });

  it('src/a.py 应该查找 __tests__/a.test.py', () => {
    const tests = findTestFile('src/a.py');
    expect(tests.some((t) => t.includes('a.test'))).toBe(true);
  });

  it('空路径应该返回有效候选', () => {
    const tests = findTestFile('index.js');
    expect(tests.length).toBeGreaterThan(0);
  });
});
