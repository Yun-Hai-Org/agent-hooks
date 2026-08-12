import { describe, it, expect } from 'bun:test';
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

  it('isPaymentPageTarget 匹配 payment 路径', () => {
    expect(isPaymentPageTarget('src/payment/checkout.html')).toBe(true);
    expect(isPaymentPageTarget('payment/page.tsx')).toBe(true);
    expect(isPaymentPageTarget('README.md')).toBe(false);
  });

  it('isPaymentPageTarget 不匹配 data/evals 报告 html', () => {
    expect(isPaymentPageTarget('data/evals/x/reports/y.html')).toBe(false);
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
