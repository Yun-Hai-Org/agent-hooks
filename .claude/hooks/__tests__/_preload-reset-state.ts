import { beforeEach, afterEach } from 'bun:test';
import { resetDetectedPlatform } from '../platform-state.js';

const ENV_VARS_TO_ISOLATE = [
  'HOOK_PLATFORM',
  'AGENT_MODE',
  'WECOM_WEBHOOK_URL',
  'FEISHU_WEBHOOK_URL',
  'SLACK_WEBHOOK_URL',
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  resetDetectedPlatform();
  for (const key of ENV_VARS_TO_ISOLATE) {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key];
    }
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_VARS_TO_ISOLATE) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});
