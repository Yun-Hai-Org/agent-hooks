import { describe, it, expect } from 'bun:test';
import { evaluateTrivyJson } from '../checks/security-scan.js';
import { hasTrivyMisconfigTargets, resolveTrivyScanners } from '../checks/file-patterns.js';
import { DECISION } from '../security-orchestrator.js';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { disableGlobalGitHooks } from './helpers.js';

describe('resolveTrivyScanners', () => {
  let tempDir: string;
  let repoPath: string;

  function setupRepo() {
    tempDir = join('/tmp', `trivy-scanners-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    repoPath = join(tempDir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    execSync('git init -b main', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
    disableGlobalGitHooks(repoPath);
  }

  function teardown() {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  }

  it('纯文档仓应跳过 misconfig', () => {
    setupRepo();
    try {
      writeFileSync(join(repoPath, 'README.md'), '# doc\n');
      execSync('git add README.md', { cwd: repoPath, stdio: 'pipe' });
      execSync('git commit -m "doc"', { cwd: repoPath, stdio: 'pipe' });
      expect(hasTrivyMisconfigTargets(repoPath)).toBe(false);
      expect(resolveTrivyScanners(repoPath)).toBe('vuln,secret,license');
    } finally {
      teardown();
    }
  });

  it('含 Dockerfile 应启用 misconfig', () => {
    setupRepo();
    try {
      writeFileSync(join(repoPath, 'Dockerfile'), 'FROM alpine\n');
      execSync('git add Dockerfile', { cwd: repoPath, stdio: 'pipe' });
      execSync('git commit -m "docker"', { cwd: repoPath, stdio: 'pipe' });
      expect(hasTrivyMisconfigTargets(repoPath)).toBe(true);
      expect(resolveTrivyScanners(repoPath)).toBe('vuln,misconfig,secret,license');
    } finally {
      teardown();
    }
  });
});

describe('evaluateTrivyJson', () => {
  it('发现 CRITICAL/HIGH/MEDIUM 漏洞应 DENY', () => {
    const json = JSON.stringify({
      Results: [{ Vulnerabilities: [{ Severity: 'HIGH' }, { Severity: 'MEDIUM' }] }],
    });
    const r = evaluateTrivyJson(json);
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('漏洞');
  });

  it('发现不合规 license（HIGH）应 DENY', () => {
    const json = JSON.stringify({
      Results: [{ Licenses: [{ Severity: 'HIGH', Name: 'GPL-3.0', PkgName: 'foo' }] }],
    });
    const r = evaluateTrivyJson(json);
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('license');
  });

  it('LOW severity license 应 DENY (strict)', () => {
    const json = JSON.stringify({
      Results: [{ Licenses: [{ Severity: 'LOW', Name: 'MIT', PkgName: 'bar' }] }],
    });
    expect(evaluateTrivyJson(json).decision).toBe(DECISION.DENY);
  });

  it('无漏洞无 license 问题应 ALLOW', () => {
    expect(evaluateTrivyJson(JSON.stringify({ Results: [] })).decision).toBe(DECISION.ALLOW);
  });

  it('输出不可解析应 fail-closed DENY', () => {
    const r = evaluateTrivyJson('not-json');
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.message).toContain('无法解析');
  });
});
