import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { runZapApiDast } from '../checks/zap-api-dast.js';
import { DECISION } from '../security-orchestrator.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

describe('zap-api-dast', () => {
  let repoDir: string;
  const prevUrl = process.env['ZAP_TARGET_URL'];

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/zap-test');
    delete process.env['ZAP_TARGET_URL'];
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    if (prevUrl === undefined) delete process.env['ZAP_TARGET_URL'];
    else process.env['ZAP_TARGET_URL'] = prevUrl;
  });

  it('无 OpenAPI 时 SKIP', async () => {
    const result = await runZapApiDast(repoDir);
    expect(result.decision).toBe(DECISION.SKIP);
  });

  it('有 OpenAPI 无 ZAP_TARGET_URL 时 DENY', async () => {
    writeFileSync(join(repoDir, 'openapi.yaml'), 'openapi: 3.0.0\ninfo: { title: t, version: 1.0.0 }\npaths: {}\n');
    const result = await runZapApiDast(repoDir);
    expect(result.decision).toBe(DECISION.DENY);
  });
});
