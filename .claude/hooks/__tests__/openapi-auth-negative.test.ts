import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runOpenApiAuthNegative } from '../checks/openapi-auth-negative.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('openapi-auth-negative', () => {
  let repoDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/auth-neg');
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    globalThis.fetch = originalFetch;
    delete process.env.ZAP_TARGET_URL;
  });

  it('无用例文件时 SKIP', async () => {
    const r = await runOpenApiAuthNegative(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
    expect(r.checkId).toBe('openapi-auth-negative');
  });

  it('有用例但无 baseUrl 时 DENY', async () => {
    writeFileSync(
      join(repoDir, 'openapi-auth-negative.yaml'),
      `cases:
  - method: GET
    path: /api/admin
    expectStatus: [401, 403]
`,
    );
    const r = await runOpenApiAuthNegative(repoDir);
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('ZAP_TARGET_URL');
  });

  it('有 baseUrl 与 openapi spec 且响应符合期望时 ALLOW', async () => {
    writeFileSync(join(repoDir, 'openapi.yaml'), 'openapi: 3.0.0\npaths: {}');
    writeFileSync(
      join(repoDir, 'openapi-auth-negative.yaml'),
      `baseUrl: http://127.0.0.1:9
cases:
  - method: GET
    path: /secure
    expectStatus: [401, 403]
`,
    );
    globalThis.fetch = async () => new Response('', { status: 401 });
    const r = await runOpenApiAuthNegative(repoDir);
    expect(r.decision).toBe(DECISION.ALLOW);
  });

  it('响应状态不符期望时 DENY', async () => {
    mkdirSync(join(repoDir, '.hooks'), { recursive: true });
    writeFileSync(join(repoDir, 'openapi.yaml'), 'openapi: 3.0.0\npaths: {}');
    writeFileSync(
      join(repoDir, '.hooks/openapi-auth-negative.yaml'),
      `cases:
  - method: POST
    path: /admin
    expectStatus: [401, 403]
`,
    );
    process.env.ZAP_TARGET_URL = 'http://127.0.0.1:9';
    globalThis.fetch = async () => new Response('', { status: 200 });
    const r = await runOpenApiAuthNegative(repoDir);
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('越权负向用例失败');
  });

  it('请求异常时 DENY', async () => {
    writeFileSync(join(repoDir, 'openapi.yaml'), 'openapi: 3.0.0\npaths: {}');
    writeFileSync(
      join(repoDir, 'openapi-auth-negative.yaml'),
      `baseUrl: http://127.0.0.1:9
cases:
  - path: /fail
`,
    );
    globalThis.fetch = async () => {
      throw new Error('connection refused');
    };
    const r = await runOpenApiAuthNegative(repoDir);
    expect(r.decision).toBe(DECISION.DENY);
  });

  it('无效 yaml 时 SKIP', async () => {
    writeFileSync(join(repoDir, 'openapi-auth-negative.yaml'), 'not: [valid');
    const r = await runOpenApiAuthNegative(repoDir);
    expect(r.decision).toBe(DECISION.SKIP);
  });

  it('ZAP_TARGET_URL 环境变量优先于 yaml baseUrl', async () => {
    writeFileSync(join(repoDir, 'openapi.yaml'), 'openapi: 3.0.0\npaths: {}');
    writeFileSync(
      join(repoDir, 'openapi-auth-negative.yaml'),
      `baseUrl: http://wrong
cases:
  - path: /x
`,
    );
    process.env.ZAP_TARGET_URL = 'http://127.0.0.1:9';
    let calledUrl = '';
    globalThis.fetch = async (url) => {
      calledUrl = String(url);
      return new Response('', { status: 403 });
    };
    const r = await runOpenApiAuthNegative(repoDir);
    expect(r.decision).toBe(DECISION.ALLOW);
    expect(calledUrl).toContain('127.0.0.1:9');
  });
});
