import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('.claude/hooks/__tests__/protect-secrets.test.js', 'utf8');

// Fix 1: Add missing '});' before the new Terraform pattern tests
content = content.replace(
  `it('CONTENT_PATTERNS 应该至少有 15 条规则', () => {
      expect(CONTENT_PATTERNS.length).toBeGreaterThanOrEqual(15);
    it('SENSITIVE_FILES 中应该有 Terraform 状态文件模式', () => {`,
  `it('CONTENT_PATTERNS 应该至少有 15 条规则', () => {
      expect(CONTENT_PATTERNS.length).toBeGreaterThanOrEqual(15);
    });

    it('SENSITIVE_FILES 中应该有 Terraform 状态文件模式', () => {`
);

// Write back
writeFileSync('.claude/hooks/__tests__/protect-secrets.test.js', content, 'utf8');
console.log('Fixed missing closing brace');
console.log('File size:', content.length);