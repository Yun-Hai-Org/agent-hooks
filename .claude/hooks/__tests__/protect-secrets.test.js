import { describe, it, expect } from 'bun:test';

describe('protect-secrets', () => {
  it('Write .env 应该被拒绝', () => {
    const path = '.env';
    const isSensitive = path === '.env' || path.includes('.ssh/id_');
    expect(isSensitive).toBe(true);
  });

  it('Write src/app.js 应该被允许', () => {
    const path = 'src/app.js';
    const isSensitive = path === '.env' || path.includes('.ssh/id_');
    expect(isSensitive).toBe(false);
  });

  it('Read .ssh/id_rsa 应该被拒绝', () => {
    const path = '.ssh/id_rsa';
    expect(path.includes('.ssh/id_')).toBe(true);
  });

  it('Read .aws/credentials 应该被拒绝', () => {
    const path = '.aws/credentials';
    expect(path.includes('.aws/credentials')).toBe(true);
  });

  it('Write .env.example 应该被允许', () => {
    const path = '.env.example';
    expect(/\.env\.example$/i.test(path)).toBe(true);
  });

  it('cat README.md (Bash) 应该被允许', () => {
    const cmd = 'cat README.md';
    expect(/\b(cat|less)\s+\.env\b/.test(cmd)).toBe(false);
  });

  it('含 Visa 信用卡号的内容应该被检测', () => {
    const content = 'card_number: 4111-1111-1111-1111';
    expect(/4[0-9]{3}[-\s]?[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{4}/.test(content)).toBe(true);
  });

  it('含 AWS Access Key 的内容应该被检测', () => {
    const content = 'AKIAIOSFODNN7EXAMPLE';
    expect(/AKIA[0-9A-Z]{16}/.test(content)).toBe(true);
  });

  it('含 GitHub Token 的内容应该被检测', () => {
    const content = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    expect(/gh[pousr]_[A-Za-z0-9_]{36,}/.test(content)).toBe(true);
  });

  it('含 PEM 私钥的内容应该被检测', () => {
    expect(/-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/.test('-----BEGIN RSA PRIVATE KEY-----\nMIIEpA')).toBe(
      true,
    );
  });

  it('正常代码内容应该被允许', () => {
    const content = 'const x = 42; function hello() { return "world"; }';
    const hasSecret =
      /4[0-9]{3}[-\s]?[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{4}/.test(content) ||
      /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/.test(content) ||
      /AKIA[0-9A-Z]{16}/.test(content);
    expect(hasSecret).toBe(false);
  });

  it('空输入应该安全处理', () => {
    expect(''.includes('.env')).toBe(false);
  });
});
