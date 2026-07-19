/**
 * Platform State - 按 cwd 持久化检测到的 IDE 平台
 *
 * 用途：原生 git hook（post-commit/pre-push/post-merge）由 git 进程调起，
 * 没有 stdin 也没有 HOOK_PLATFORM 环境变量。但 IDE hook 在同 cwd 下先运行过
 * （PreToolUse/Stop/SessionEnd 等），已把检测到的平台写入此处的状态文件。
 * 原生 git hook 通过 getPlatform() 的第 3 级 fallback 读取此文件。
 *
 * 落盘位置：~/.claude/platform-state/<cwd-slug>.json
 * TTL：7 天，避免陈旧状态长期污染。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { HookPlatform } from './types.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function stateDir(): string {
  // 用 process.env.HOME 而非 os.homedir()：前者在测试中可被覆盖，
  // 后者在 macOS 上读 getpwuid 不读 env，导致测试隔离失败
  const home = process.env['HOME'] ?? '';
  return join(home, '.claude', 'platform-state');
}

function statePath(cwd: string): string {
  const key = cwd.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  return join(stateDir(), `${key}.json`);
}

export function persistPlatform(platform: HookPlatform, cwd: string): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- 运行时防御：调用方可能传空字符串
  if (!platform || !cwd) return;
  try {
    const dir = stateDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(statePath(cwd), JSON.stringify({ platform, ts: Date.now() }), 'utf8');
  } catch {
    // fail-open：持久化失败不影响 hook 主流程
  }
}

export function readPersistedPlatform(cwd?: string): HookPlatform | undefined {
  if (!cwd) return undefined;
  try {
    const path = statePath(cwd);
    if (!existsSync(path)) return undefined;
    const data = JSON.parse(readFileSync(path, 'utf8')) as { platform?: string; ts?: number };
    if (typeof data.ts === 'number' && Date.now() - data.ts > TTL_MS) return undefined;
    if (data.platform === 'claude' || data.platform === 'cursor' || data.platform === 'kiro') {
      return data.platform;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ─── 进程级检测状态（无循环依赖：本模块只依赖 types.js）──────────────────

let _detectedPlatform: HookPlatform | undefined;

/** 从 stdin JSON 字段形态推断平台。供 IDE hook 在解析 stdin 后调用。 */
export function detectPlatformFromStdin(data: Record<string, unknown>): HookPlatform {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- 运行时防御：调用方可能传 null/非对象
  if (!data || typeof data !== 'object') return 'claude';
  if (typeof data['hook_event_name'] === 'string' && data['hook_event_name']) return 'claude';
  if (typeof data['transcript_path'] === 'string' && data['transcript_path']) return 'claude';
  if (typeof data['conversation_id'] === 'string' && data['conversation_id']) return 'cursor';
  if (Array.isArray(data['workspace_roots']) && data['workspace_roots'].length) return 'cursor';
  if (typeof data['sessionId'] === 'string' && data['sessionId']) return 'kiro';
  if (typeof data['toolName'] === 'string' && data['toolName']) return 'kiro';
  return 'claude';
}

/**
 * 设置当前进程检测到的平台，同时按 cwd 持久化供原生 git hook 后续读取。
 * cwd 优先取传入值，回退 process.cwd()。
 */
export function setDetectedPlatform(platform: HookPlatform | undefined, cwd?: string): void {
  _detectedPlatform = platform;
  if (platform) {
    const resolvedCwd = cwd ?? process.cwd();
    persistPlatform(platform, resolvedCwd);
  }
}

export function getDetectedPlatform(): HookPlatform | undefined {
  return _detectedPlatform;
}
