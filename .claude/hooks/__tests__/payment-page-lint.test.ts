import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { lintPaymentPageContent, isPaymentPageTarget } from '../checks/payment-page-lint.js';
import { listAllGatePaths } from '../gate-registry.js';

const ALLOW = ['https://cdn.example.com', 'https://js.stripe.com'];

describe('payment-page-lint', () => {
  it('检测外链 script 缺少 SRI', () => {
    const html = '<script src="https://cdn.example.com/lib.js"></script>';
    const issues = lintPaymentPageContent('payment/checkout.html', html, ALLOW);
    expect(issues.some((i) => i.includes('SRI'))).toBe(true);
  });

  it('有 SRI 的外链 script 通过', () => {
    const html =
      '<script src="https://cdn.example.com/lib.js" integrity="sha384-abc"></script><meta http-equiv="Content-Security-Policy" content="default-src self">';
    const issues = lintPaymentPageContent('payment/page.html', html, ALLOW);
    expect(issues.length).toBe(0);
  });

  it('不在白名单的 script 源应报错', () => {
    const html = '<script src="https://evil.example.com/x.js" integrity="sha384-abc"></script>';
    const issues = lintPaymentPageContent('payment/page.html', html, ALLOW);
    expect(issues.some((i) => i.includes('白名单'))).toBe(true);
  });

  it('isPaymentPageTarget 匹配 payment 路径，不把任意 html 当支付页', () => {
    expect(isPaymentPageTarget('src/payment/checkout.html')).toBe(true);
    expect(isPaymentPageTarget('checkout/page.tsx')).toBe(true);
    expect(isPaymentPageTarget('docs/random.html')).toBe(false);
    expect(isPaymentPageTarget('index.htm')).toBe(false);
    expect(isPaymentPageTarget('README.md')).toBe(false);
  });

  it('runPaymentPageStaged 应使用 getScopedStagedFiles 且路径模式不含任意 html', () => {
    const sourceFile = join(import.meta.dir, '..', 'checks', 'payment-page-lint.ts');
    const content = readFileSync(sourceFile, 'utf-8');
    expect(content).toContain('getScopedStagedFiles');
    expect(content).toMatch(/runPaymentPageStaged[\s\S]*?getScopedStagedFiles/);
    expect(content).not.toContain('|\\.html?$');
  });
});

describe('fintech registry paths', () => {
  it('包含 fintech check 路径', () => {
    const paths = listAllGatePaths();
    expect(paths).toContain('git.pre-commit.checks.semgrep-pci-staged');
    expect(paths).toContain('git.pre-merge-commit.checks.sbom-archive');
    expect(paths).toContain('git.pre-push.checks.zap-api-dast');
    expect(paths).toContain('git.pre-merge-commit.checks.iac-checkov');
  });
});
