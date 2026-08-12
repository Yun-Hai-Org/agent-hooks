import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { formatResult, DECISION } from '../security-orchestrator.js';
import { listTrackedFiles } from './file-patterns.js';
import { filterPathsByScope, getScanScope, getScopedStagedFiles } from './scan-scope.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const ALLOWLIST_PATH = '.hooks/payment-script-allowlist.yaml';
const PAYMENT_PATH_PATTERN = /(?:^|\/)(payment|checkout|pay|billing)(?:\/|$)/i;
const EXTERNAL_SCRIPT = /<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*>/gi;
const SRI_ATTR = /\bintegrity=["'][^"']+["']/i;

interface PaymentScriptAllowlist {
  allowed_origins?: string[];
}

export function loadPaymentScriptAllowlist(cwd: string): string[] | null {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，ALLOWLIST_PATH 为常量
  const path = join(cwd, ALLOWLIST_PATH);
  if (!existsSync(path)) return null;
  try {
    const parsed = yaml.load(readFileSync(path, 'utf-8')) as PaymentScriptAllowlist;
    return Array.isArray(parsed.allowed_origins) ? parsed.allowed_origins : [];
  } catch {
    return null;
  }
}

export function extractExternalScriptSrcs(content: string): string[] {
  const tags = content.match(EXTERNAL_SCRIPT) ?? [];
  const srcs: string[] = [];
  for (const tag of tags) {
    const match = /src=["'](https?:\/\/[^"']+)["']/i.exec(tag);
    if (match?.[1]) srcs.push(match[1]);
  }
  return srcs;
}

export function scriptOrigin(src: string): string {
  try {
    return new URL(src).origin;
  } catch {
    return src;
  }
}

export function isPaymentPageTarget(file: string): boolean {
  return PAYMENT_PATH_PATTERN.test(file) && /\.(html?|tsx?|jsx?|vue|svelte)$/i.test(file);
}

export function lintPaymentPageContent(file: string, content: string, allowedOrigins: string[] | null): string[] {
  const issues: string[] = [];
  if (allowedOrigins === null) {
    issues.push(`${file}: 缺少 ${ALLOWLIST_PATH}，无法校验外链 script 白名单`);
    return issues;
  }

  const srcs = extractExternalScriptSrcs(content);
  const scripts = content.match(EXTERNAL_SCRIPT) ?? [];
  for (const src of srcs) {
    const origin = scriptOrigin(src);
    if (!allowedOrigins.includes(origin)) {
      issues.push(`${file}: 外链 script 不在白名单: ${origin} (${src.slice(0, 80)})`);
    }
  }
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
  const allowedOrigins = loadPaymentScriptAllowlist(cwd);
  const issues: string[] = [];
  for (const file of targets) {
    try {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，file 来自 git 暂存/tracked 路径
      const content = readFileSync(join(cwd, file), 'utf-8');
      issues.push(...lintPaymentPageContent(file, content, allowedOrigins));
    } catch {
      issues.push(`${file}: 无法读取`);
    }
  }
  if (issues.length > 0) {
    return formatResult(checkId, DECISION.DENY, `Payment Page 检查失败 (${String(issues.length)} 项)`, {
      output: issues.slice(0, 15).join('\n'),
    });
  }
  return formatResult(checkId, DECISION.ALLOW, 'Payment Page 脚本/SRI/白名单检查通过');
}

export function runPaymentPageStaged(cwd?: string, _options?: GateCheckRunOptions): CheckResult {
  const root = cwd ?? process.cwd();
  return lintFiles(getScopedStagedFiles(root), root, 'payment-page-staged');
}

export function runPaymentPageFull(cwd?: string, _options?: GateCheckRunOptions): CheckResult {
  const root = cwd ?? process.cwd();
  const files = filterPathsByScope(listTrackedFiles(isPaymentPageTarget, root), getScanScope(root));
  return lintFiles(files, root, 'payment-page-full');
}
