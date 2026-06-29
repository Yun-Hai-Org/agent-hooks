import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { execCommand, formatResult, DECISION } from '../security-orchestrator.js';
import type { CheckResult, GateCheckRunOptions } from '../types.js';

const CASES_PATHS = ['openapi-auth-negative.yaml', '.hooks/openapi-auth-negative.yaml'];

interface AuthNegativeCase {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  expectStatus?: number[];
}

interface AuthNegativeSpec {
  baseUrl?: string;
  cases?: AuthNegativeCase[];
}

function findCasesFile(cwd: string): string | null {
  for (const rel of CASES_PATHS) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，rel 为常量候选路径
    const p = join(cwd, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

function findOpenApiSpec(cwd: string): string | null {
  const candidates = ['openapi.yaml', 'openapi.yml', 'docs/openapi.yaml'];
  for (const c of candidates) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，c 为常量候选路径
    if (existsSync(join(cwd, c))) return c;
  }
  const result = execCommand('git ls-files "*openapi*.yaml" "*openapi*.yml" | head -1', { cwd });
  return result.success && result.stdout.trim() ? result.stdout.trim() : null;
}

function loadSpec(cwd: string): AuthNegativeSpec | null {
  const path = findCasesFile(cwd);
  if (!path) return null;
  try {
    const parsed = yaml.load(readFileSync(path, 'utf-8')) as AuthNegativeSpec;
    return Array.isArray(parsed.cases) ? parsed : null;
  } catch {
    return null;
  }
}

export async function runOpenApiAuthNegative(cwd?: string, _options?: GateCheckRunOptions): Promise<CheckResult> {
  const root = cwd ?? process.cwd();
  const spec = loadSpec(root);
  if (!spec?.cases || spec.cases.length === 0) {
    return formatResult('openapi-auth-negative', DECISION.SKIP, '无 openapi-auth-negative 用例文件，跳过');
  }

  const baseUrl = (process.env['ZAP_TARGET_URL'] ?? spec.baseUrl ?? '').trim();
  if (!baseUrl) {
    return formatResult('openapi-auth-negative', DECISION.DENY, '存在越权负向用例但未设置 ZAP_TARGET_URL 或 baseUrl');
  }

  if (!findOpenApiSpec(root)) {
    return formatResult('openapi-auth-negative', DECISION.SKIP, '未找到 OpenAPI spec，跳过越权负向用例');
  }

  const failures: string[] = [];
  for (const c of spec.cases) {
    const method = (c.method ?? 'GET').toUpperCase();
    const path = c.path ?? '/';
    const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
    const expect = c.expectStatus ?? [401, 403];
    try {
      const response = await fetch(url, {
        method,
        headers: c.headers ?? {},
        signal: AbortSignal.timeout(15000),
      });
      if (!expect.includes(response.status)) {
        failures.push(`${method} ${path} → ${String(response.status)}，期望 ${expect.join('|')}`);
      }
    } catch (e) {
      failures.push(`${method} ${path} → 请求失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (failures.length > 0) {
    return formatResult('openapi-auth-negative', DECISION.DENY, 'OpenAPI 越权负向用例失败', {
      output: failures.slice(0, 10).join('\n'),
    });
  }
  return formatResult('openapi-auth-negative', DECISION.ALLOW, 'OpenAPI 越权负向用例通过');
}
