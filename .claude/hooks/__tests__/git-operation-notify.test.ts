import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { clearGateConfigCache, getGitOperationNotifyConfig } from '../gate-config.js';
import {
  formatFeishuGitOperationMessage,
  formatSlackGitOperationMessage,
  formatWechatGitOperationMessage,
  gitOperationTitle,
  clearCooldownState,
} from '../notification-core.js';
import { handleGitOperationNotify, isMergeCommit } from '../git-operation-notify.js';
import { createTempGitRepo, cleanupTempGitRepo } from './helpers.js';

function writeGitNotifyYaml(repoDir: string, overrides?: { operations?: string[]; enabled?: boolean }) {
  mkdirSync(join(repoDir, '.claude'), { recursive: true });
  const enabled = overrides?.enabled ?? true;
  const operations = overrides?.operations ?? ['commit', 'push', 'merge'];
  const opsBlock = operations.map((op) => `      - ${op}`).join('\n');
  writeFileSync(
    join(repoDir, '.claude/quality-gate.yaml'),
    `settings:
  notifications:
    channels:
      wechat:
        url: ""
git:
  git-operation-notify:
    enabled: ${String(enabled)}
    timeout: 5s
    operations:
${opsBlock}
`,
  );
  clearGateConfigCache();
}

describe('git-operation-notify', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo('feat/git-op-notify');
    clearGateConfigCache();
    clearCooldownState();
  });

  afterEach(() => {
    cleanupTempGitRepo(repoDir);
    clearGateConfigCache();
    clearCooldownState();
  });

  it('gitOperationTitle 应区分操作类型', () => {
    expect(gitOperationTitle('commit')).toContain('提交通知');
    expect(gitOperationTitle('push')).toContain('推送通知');
    expect(gitOperationTitle('merge')).toContain('合并通知');
  });

  it('formatWechatGitOperationMessage 应含项目分支与说明', () => {
    const body = formatWechatGitOperationMessage(
      {
        operation: 'commit',
        projectName: 'demo',
        platform: 'Git',
        branch: 'feat/test',
        summaryText: 'feat: add notify',
        commitSha: 'abc1234567890',
      },
      '2026/7/3 12:00:00',
      1500,
    );
    const content = (body.markdown as { content: string }).content;
    expect(content).toContain('demo');
    expect(content).toContain('feat/test');
    expect(content).toContain('feat: add notify');
    expect(content).toContain('**说明**');
    expect(content).toContain('abc1234');
  });

  it('formatFeishuGitOperationMessage 应生成 interactive 卡片', () => {
    const body = formatFeishuGitOperationMessage(
      {
        operation: 'push',
        projectName: 'demo',
        platform: 'Git',
        branch: 'main',
        summaryText: 'push ok',
      },
      '2026/7/3 12:00:00',
      1500,
    );
    expect(body.msg_type).toBe('interactive');
    expect(body.card.elements[1].text.content).toContain('push ok');
  });

  it('formatSlackGitOperationMessage 应生成 attachments', () => {
    const body = formatSlackGitOperationMessage(
      {
        operation: 'merge',
        projectName: 'demo',
        platform: 'Git',
        branch: 'master',
        summaryText: 'merge done',
      },
      '2026/7/3 12:00:00',
      1500,
    );
    expect(Array.isArray(body.attachments)).toBe(true);
  });

  it('getGitOperationNotifyConfig 应读取 operations', () => {
    writeGitNotifyYaml(repoDir, { operations: ['commit', 'push'] });
    const config = getGitOperationNotifyConfig(repoDir);
    expect(config.enabled).toBe(true);
    expect(config.operations).toEqual(['commit', 'push']);
  });

  it('yaml 无 git-operation-notify 节时应 registry 默认启用', () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(
      join(repoDir, '.claude/quality-gate.yaml'),
      `settings:
  notifications:
    channels:
      wechat:
        url: ""
`,
    );
    clearGateConfigCache();
    expect(getGitOperationNotifyConfig(repoDir).enabled).toBe(true);
  });

  it('operation 未启用时应 operation_filtered', async () => {
    writeGitNotifyYaml(repoDir, { operations: ['push'] });
    const result = await handleGitOperationNotify('commit', repoDir);
    expect(result.reason).toBe('operation_filtered');
  });

  it('无 Webhook 时应 no_channels', async () => {
    writeGitNotifyYaml(repoDir);
    const result = await handleGitOperationNotify('commit', repoDir);
    expect(result.reason).toBe('no_channels');
  });

  it('isMergeCommit 普通提交应为 false', () => {
    expect(isMergeCommit(repoDir)).toBe(false);
  });
});
