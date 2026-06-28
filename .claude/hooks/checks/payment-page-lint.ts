import { readFileSync } from 'fs';
import { join } from 'path';
import { formatResult, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { listTrackedFiles } from './file-patterns.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const PAYMENT_PATH_PATTERN = /(?:^|\/)(payment|checkout|pay|billing)(?:\/|$)|\.html?$/i;
const EXTERNAL_SCRIPT = /<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*>/gi;
const SRI_ATTR = /\bintegrity=["'][^"']+["']/i;

export function isPaymentPageTarget(file: string): boolean {
  return PAYMENT_PATH_PATTERN.test(file) && /\.(html?|tsx?|jsx?|vue|svelte)$/i.test(file);
}

export function lintPaymentPageContent(file: string, content: string): string[] {
  const issues: string[] = [];
  const scripts = content.match(EXTERNAL_SCRIPT) ?? [];
  for (const tag of scripts) {
    if (!SRI_ATTR.test(tag)) {
      issues.push(`${file}: 外链 script 缺少 integrity (SRI): ${tag.slice(0, 80)}`);
    }
  }
  if (scripts.length > 0 && !/Content-Security-Policy|content-security-policy/i.test(content)) {
    issues.push(`${file}: 含外链 script 但未见 CSP meta/header 引用`);
  }
  return issues;
}

function lintFiles(files: string[], cwd: string, checkId: string): CheckResult {
  const targets = files.filter(isPaymentPageTarget);
  if (targets.length === 0) {
    return formatResult(checkId, DECISION.SKIP, '无支付页面前端文件，跳过');
  }
  const issues: string[] = [];
  for (const file of targets) {
    try {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，file 来自 git 暂存/tracked 路径
      const content = readFileSync(join(cwd, file), 'utf-8');
      issues.push(...lintPaymentPageContent(file, content));
    } catch {
      issues.push(`${file}: 无法读取`);
    }
  }
  if (issues.length > 0) {
    return formatResult(checkId, DECISION.DENY, `Payment Page 检查失败 (${String(issues.length)} 项)`, {
      output: issues.slice(0, 15).join('\n'),
    });
  }
  return formatResult(checkId, DECISION.ALLOW, 'Payment Page 脚本/SRI 检查通过');
}

export function runPaymentPageStaged(cwd?: string, _options?: GateCheckRunOptions): CheckResult {
  const root = cwd ?? process.cwd();
  return lintFiles(getStagedFiles(root), root, 'payment-page-staged');
}

export function runPaymentPageFull(cwd?: string, _options?: GateCheckRunOptions): CheckResult {
  const root = cwd ?? process.cwd();
  const files = listTrackedFiles(isPaymentPageTarget, root);
  return lintFiles(files, root, 'payment-page-full');
}
