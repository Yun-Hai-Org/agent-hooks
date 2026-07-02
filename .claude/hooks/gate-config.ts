import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';
import {
  getHookRootPath,
  getRegistryDefaultTimeoutMs,
  getRegistryNode,
  nodeSupportsAutoFix,
  REGISTRY_COMMIT_TIMEOUT_MS,
  REGISTRY_FULL_TIMEOUT_MS,
} from './gate-registry.js';
import type { CoverageThresholdOptions } from './types.js';
import { DEFAULT_COVERAGE_THRESHOLDS } from './checks/coverage.js';

export type SessionEndTrigger = 'session_end' | 'stop' | 'both';

export interface GateConfigEntry {
  enabled?: boolean;
  autoFix?: boolean;
  timeout?: string | number;
  timeoutMs?: number;
  trigger?: SessionEndTrigger;
  maxSummaryChars?: number;
  checks?: Record<string, GateConfigEntry>;
  rules?: Record<string, GateConfigEntry>;
  platforms?: Record<string, GateConfigEntry>;
}

export interface NotificationChannelConfig {
  url?: string;
}

export interface NotificationSettings {
  timeout?: string | number;
  cooldown?: string | number;
  channels?: {
    wechat?: NotificationChannelConfig;
    feishu?: NotificationChannelConfig;
    slack?: NotificationChannelConfig;
  };
}

export type SessionEndNotifyEntry = GateConfigEntry;

export interface ScanScopeConfig {
  include?: string[];
  exclude?: string[];
}

export interface CoverageThresholdYaml {
  lines?: number;
  functions?: number;
}

export type PushMergeBranchMode = 'all' | 'selected';

export interface PushMergeBranchPolicy {
  mode?: PushMergeBranchMode;
  include?: string[];
  exclude?: string[];
}

export interface GateSettings {
  coverageThreshold?: number | CoverageThresholdYaml;
  scanScope?: ScanScopeConfig;
  pushMergeBranches?: PushMergeBranchPolicy;
  licenseDenylist?: string[];
  notifications?: NotificationSettings;
}

export interface GateConfig {
  settings?: GateSettings;
  ide?: Record<string, GateConfigEntry>;
  git?: Record<string, GateConfigEntry>;
}

export interface ResolvedGateNode {
  configured: boolean;
  enabled: boolean;
  autoFix?: boolean | undefined;
  timeoutMs?: number | undefined;
}

const GLOBAL_CONFIG_PATH = join(homedir(), '.claude', 'quality-gate.yaml');

interface CacheEntry {
  mtimeGlobal: number;
  mtimeRepo: number;
  merged: GateConfig;
}

const configCache = new Map<string, CacheEntry>();

export function clearGateConfigCache(): void {
  configCache.clear();
}

function deepMergeConfig(base: GateConfig, override: GateConfig): GateConfig {
  const result: GateConfig = { ...base };
  if (override.settings || base.settings) {
    result.settings = mergeSettings(base.settings, override.settings);
  }
  for (const section of ['ide', 'git'] as const) {
    const baseSection = base[section] ?? {};
    const overrideSection = override[section];
    if (!overrideSection) continue;
    const sectionMap = result[section] ?? {};
    for (const [hookId, hookOverride] of Object.entries(overrideSection)) {
      const baseHook = baseSection[hookId];
      sectionMap[hookId] = mergeEntry(baseHook, hookOverride);
    }
    result[section] = sectionMap;
  }
  return result;
}

function mergeCoverageThresholdYaml(
  base?: number | CoverageThresholdYaml,
  override?: number | CoverageThresholdYaml,
): number | CoverageThresholdYaml | undefined {
  if (override === undefined) return base;
  if (base === undefined) return override;
  if (typeof base === 'number' && typeof override === 'number') return override;
  if (typeof base === 'number') {
    const o = typeof override === 'number' ? { lines: override, functions: override } : override;
    return { lines: o.lines ?? base, functions: o.functions ?? base };
  }
  if (typeof override === 'number') {
    return { lines: base.lines ?? override, functions: base.functions ?? override };
  }
  const lines = override.lines ?? base.lines;
  const functions = override.functions ?? base.functions;
  const merged: CoverageThresholdYaml = {};
  if (lines !== undefined) merged.lines = lines;
  if (functions !== undefined) merged.functions = functions;
  return merged;
}

function mergeSettings(base?: GateSettings, override?: GateSettings): GateSettings {
  if (!base) return structuredClone(override ?? {});
  if (!override) return structuredClone(base);
  const merged: GateSettings = { ...base, ...override };
  const coverageThreshold = mergeCoverageThresholdYaml(base.coverageThreshold, override.coverageThreshold);
  if (coverageThreshold !== undefined) merged.coverageThreshold = coverageThreshold;
  if (base.scanScope || override.scanScope) {
    const include = override.scanScope?.include ?? base.scanScope?.include;
    const exclude = [...new Set([...(base.scanScope?.exclude ?? []), ...(override.scanScope?.exclude ?? [])])];
    merged.scanScope = { ...(include !== undefined ? { include } : {}), ...(exclude.length > 0 ? { exclude } : {}) };
  }
  if (base.pushMergeBranches || override.pushMergeBranches) {
    const mode = override.pushMergeBranches?.mode ?? base.pushMergeBranches?.mode;
    const include = [
      ...new Set([...(base.pushMergeBranches?.include ?? []), ...(override.pushMergeBranches?.include ?? [])]),
    ];
    const exclude = [
      ...new Set([...(base.pushMergeBranches?.exclude ?? []), ...(override.pushMergeBranches?.exclude ?? [])]),
    ];
    merged.pushMergeBranches = {
      ...(mode !== undefined ? { mode } : {}),
      ...(include.length > 0 ? { include } : {}),
      ...(exclude.length > 0 ? { exclude } : {}),
    };
  }
  if (base.licenseDenylist || override.licenseDenylist) {
    merged.licenseDenylist = [...new Set([...(base.licenseDenylist ?? []), ...(override.licenseDenylist ?? [])])];
  }
  if (base.notifications || override.notifications) {
    merged.notifications = mergeNotificationSettings(base.notifications, override.notifications);
  }
  return merged;
}

function mergeNotificationChannel(
  base?: NotificationChannelConfig,
  override?: NotificationChannelConfig,
): NotificationChannelConfig | undefined {
  if (!base && !override) return undefined;
  const overrideUrl = override?.url?.trim();
  const baseUrl = base?.url?.trim();
  let url: string | undefined;
  if (overrideUrl) url = overrideUrl;
  else if (baseUrl) url = baseUrl;
  return { ...base, ...override, ...(url ? { url } : {}) };
}

function mergeNotificationSettings(base?: NotificationSettings, override?: NotificationSettings): NotificationSettings {
  if (!base) return structuredClone(override ?? {});
  if (!override) return structuredClone(base);
  const merged: NotificationSettings = { ...base, ...override };
  if (base.channels || override.channels) {
    const channels: NonNullable<NotificationSettings['channels']> = {
      ...base.channels,
      ...override.channels,
    };
    const wechat = mergeNotificationChannel(base.channels?.wechat, override.channels?.wechat);
    const feishu = mergeNotificationChannel(base.channels?.feishu, override.channels?.feishu);
    const slack = mergeNotificationChannel(base.channels?.slack, override.channels?.slack);
    if (wechat !== undefined) channels.wechat = wechat;
    if (feishu !== undefined) channels.feishu = feishu;
    if (slack !== undefined) channels.slack = slack;
    merged.channels = channels;
  }
  return merged;
}

function mergeEntry(base: GateConfigEntry | undefined, override: GateConfigEntry): GateConfigEntry {
  if (!base) return structuredClone(override);
  const merged: GateConfigEntry = { ...base, ...override };
  if (base.checks || override.checks) {
    merged.checks = { ...base.checks };
    for (const [id, child] of Object.entries(override.checks ?? {})) {
      merged.checks[id] = mergeEntry(base.checks?.[id], child);
    }
  }
  if (base.rules || override.rules) {
    merged.rules = { ...base.rules };
    for (const [id, child] of Object.entries(override.rules ?? {})) {
      merged.rules[id] = mergeEntry(base.rules?.[id], child);
    }
  }
  if (base.platforms || override.platforms) {
    merged.platforms = { ...base.platforms };
    for (const [id, child] of Object.entries(override.platforms ?? {})) {
      merged.platforms[id] = mergeEntry(base.platforms?.[id], child);
    }
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readYamlFile(path: string): GateConfig {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8');
  const parsed = yaml.load(raw);
  if (!isRecord(parsed)) return {};
  return parsed;
}

function getRepoConfigPath(cwd: string): string {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为受信仓库根，第二参为常量
  return join(cwd, '.claude', 'quality-gate.yaml');
}

function getFileMtime(path: string): number {
  if (!existsSync(path)) return 0;
  return statSync(path).mtimeMs;
}

export function loadGateConfig(cwd: string): GateConfig {
  const repoPath = getRepoConfigPath(cwd);
  const mtimeGlobal = getFileMtime(GLOBAL_CONFIG_PATH);
  const mtimeRepo = getFileMtime(repoPath);
  const cached = configCache.get(cwd);
  if (cached?.mtimeGlobal === mtimeGlobal && cached.mtimeRepo === mtimeRepo) {
    return cached.merged;
  }
  const merged = deepMergeConfig(readYamlFile(GLOBAL_CONFIG_PATH), readYamlFile(repoPath));
  configCache.set(cwd, { mtimeGlobal, mtimeRepo, merged });
  return merged;
}

/** 解析 duration：90s | 5m | 15m | 1h | 500ms | 纯数字视为 ms */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  const trimmed = String(value).trim();
  if (!trimmed) return 0;
  const msMatch = /^(\d+(?:\.\d+)?)\s*ms$/i.exec(trimmed);
  if (msMatch?.[1]) return Math.max(0, Math.round(Number(msMatch[1])));
  const sMatch = /^(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?$/i.exec(trimmed);
  if (sMatch?.[1]) return Math.max(0, Math.round(Number(sMatch[1]) * 1000));
  const mMatch = /^(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?$/i.exec(trimmed);
  if (mMatch?.[1]) return Math.max(0, Math.round(Number(mMatch[1]) * 60_000));
  const hMatch = /^(\d+(?:\.\d+)?)\s*h(?:our(?:s)?)?$/i.exec(trimmed);
  if (hMatch?.[1]) return Math.max(0, Math.round(Number(hMatch[1]) * 3_600_000));
  const n = Number(trimmed);
  if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  throw new Error(`无法解析 timeout  duration: ${trimmed}`);
}

export function normalizeTimeout(entry: GateConfigEntry | undefined): number | undefined {
  if (!entry) return undefined;
  if (entry.timeoutMs !== undefined && Number.isFinite(entry.timeoutMs)) {
    return Math.max(0, Math.round(entry.timeoutMs));
  }
  if (entry.timeout !== undefined && entry.timeout !== '') {
    const ms = parseDuration(entry.timeout);
    return ms === 0 ? undefined : ms;
  }
  return undefined;
}

function getSectionHook(config: GateConfig, section: 'ide' | 'git', hookId: string): GateConfigEntry | undefined {
  return config[section]?.[hookId];
}

function configNodeExists(config: GateConfig, path: string): boolean {
  const parts = path.split('.');
  if (parts.length < 2) return false;
  const section = parts[0];
  if (section !== 'ide' && section !== 'git') return false;
  const hookId = parts[1];
  if (!hookId) return false;
  let current: GateConfigEntry | undefined = getSectionHook(config, section, hookId);
  if (current === undefined) return false;
  for (let i = 2; i < parts.length; ) {
    const part = parts[i];
    if (!part) return false;
    if (part === 'checks' || part === 'rules') {
      if (i + 1 >= parts.length) return false;
      const childKey = parts[i + 1];
      if (!childKey) return false;
      const bucket: Record<string, GateConfigEntry> | undefined = part === 'checks' ? current?.checks : current?.rules;
      if (!bucket || !(childKey in bucket)) return false;
      current = bucket[childKey];
      i += 2;
      continue;
    }
    return false;
  }
  return true;
}

function getConfigEntry(config: GateConfig, path: string): GateConfigEntry | undefined {
  if (!configNodeExists(config, path)) return undefined;
  const parts = path.split('.');
  const section = parts[0];
  const hookId = parts[1];
  if (section !== 'ide' && section !== 'git') return undefined;
  if (!hookId) return undefined;
  let current: GateConfigEntry | undefined = getSectionHook(config, section, hookId);
  for (let i = 2; i < parts.length; ) {
    const part = parts[i];
    if (!part) return undefined;
    if (part === 'checks' || part === 'rules') {
      const childKey = parts[i + 1];
      if (!childKey) return undefined;
      const bucket = part === 'checks' ? current?.checks : current?.rules;
      current = bucket?.[childKey];
      i += 2;
      continue;
    }
    return undefined;
  }
  return current;
}

function resolveAutoFix(config: GateConfig, path: string): boolean | undefined {
  if (!configNodeExists(config, path)) return undefined;
  if (!nodeSupportsAutoFix(path)) return false;

  const parts = path.split('.');
  for (let len = parts.length; len >= 2; len--) {
    const subPath = parts.slice(0, len).join('.');
    if (!configNodeExists(config, subPath)) continue;
    const entry = getConfigEntry(config, subPath);
    if (entry?.autoFix !== undefined) {
      return entry.autoFix;
    }
  }
  return undefined;
}

function resolveEnabled(config: GateConfig, path: string): { configured: boolean; enabled: boolean } {
  if (!configNodeExists(config, path)) {
    return { configured: false, enabled: false };
  }
  const parts = path.split('.');
  for (let len = parts.length; len >= 2; len--) {
    const subPath = parts.slice(0, len).join('.');
    if (!configNodeExists(config, subPath)) continue;
    const entry = getConfigEntry(config, subPath);
    if (entry?.enabled !== undefined) {
      return { configured: true, enabled: entry.enabled };
    }
  }
  return { configured: true, enabled: false };
}

function findAncestorTimeoutMs(config: GateConfig, path: string): number | undefined {
  const parts = path.split('.');
  for (let len = parts.length; len >= 2; len--) {
    const subPath = parts.slice(0, len).join('.');
    if (!configNodeExists(config, subPath)) continue;
    const ms = normalizeTimeout(getConfigEntry(config, subPath));
    if (ms !== undefined) return ms;
  }
  return undefined;
}

function registryFallbackTimeoutMs(path: string): number | undefined {
  const hookRoot = getHookRootPath(path);
  const fromRegistry = getRegistryDefaultTimeoutMs(path);
  if (fromRegistry !== undefined) return fromRegistry;
  if (hookRoot === 'git.pre-commit') return REGISTRY_COMMIT_TIMEOUT_MS;
  if (hookRoot === 'git.pre-push' || hookRoot === 'git.pre-merge-commit') return REGISTRY_FULL_TIMEOUT_MS;
  return undefined;
}

function resolveTimeoutMs(config: GateConfig, path: string): number | undefined {
  const hookRoot = getHookRootPath(path);
  let parentTimeoutMs = findAncestorTimeoutMs(config, hookRoot);
  if (parentTimeoutMs === undefined) {
    parentTimeoutMs = registryFallbackTimeoutMs(path);
    if (parentTimeoutMs !== undefined) {
      console.warn(`[gate-config] ${hookRoot} 未配置 timeout，使用 registry 建议值 ${String(parentTimeoutMs)}ms`);
    }
  }

  const registryNode = getRegistryNode(path);
  if (
    registryNode &&
    registryNode.defaultTimeoutMs === undefined &&
    !path.includes('.checks.') &&
    !path.includes('.rules.')
  ) {
    // 无 timeout 需求的 hook（如 branch-gate）
    if (parentTimeoutMs === undefined) return undefined;
  }

  const explicitMs = normalizeTimeout(getConfigEntry(config, path));
  let requestedMs = explicitMs ?? parentTimeoutMs;
  if (requestedMs === undefined) {
    if (path.includes('.checks.') || path.includes('.rules.')) {
      requestedMs = parentTimeoutMs ?? registryFallbackTimeoutMs(path);
      if (requestedMs === undefined) return undefined;
    } else {
      return undefined;
    }
  }

  if (path === hookRoot || (!path.includes('.checks.') && !path.includes('.rules.'))) {
    return requestedMs;
  }

  const capMs = parentTimeoutMs ?? registryFallbackTimeoutMs(path);
  if (capMs === undefined) return requestedMs;
  if (requestedMs > capMs) {
    console.warn(`[gate-config] ${path} timeout ${String(requestedMs)}ms 超过总项 ${String(capMs)}ms，已截断`);
    return capMs;
  }
  return requestedMs;
}

export function resolveGateNode(path: string, cwd: string = process.cwd()): ResolvedGateNode {
  const config = loadGateConfig(cwd);
  const { configured, enabled } = resolveEnabled(config, path);
  if (!configured) {
    return { configured: false, enabled: false };
  }

  const hookRoot = getHookRootPath(path);
  if (path !== hookRoot) {
    const parent = resolveEnabled(config, hookRoot);
    if (parent.configured && !parent.enabled) {
      return { configured: true, enabled: false };
    }
  }

  const timeoutMs = resolveTimeoutMs(config, path);
  const autoFix = resolveAutoFix(config, path);
  const resolved: ResolvedGateNode = { configured, enabled };
  if (timeoutMs !== undefined) resolved.timeoutMs = timeoutMs;
  if (autoFix !== undefined) resolved.autoFix = autoFix;
  return resolved;
}

export function isGateNodeEnabled(path: string, cwd: string = process.cwd()): boolean {
  const node = resolveGateNode(path, cwd);
  return node.configured && node.enabled;
}

export function getGateNodeTimeout(path: string, cwd: string = process.cwd()): number | undefined {
  return resolveGateNode(path, cwd).timeoutMs;
}

export function isGateNodeAutoFixEnabled(path: string, cwd: string = process.cwd()): boolean {
  const node = resolveGateNode(path, cwd);
  if (!node.configured || !node.enabled) return false;
  if (!nodeSupportsAutoFix(path)) return false;
  return node.autoFix === true;
}

export function formatGateTimeoutLabel(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec >= 60 && totalSec % 60 === 0) {
    return `${String(totalSec / 60)}min`;
  }
  return `${String(totalSec)}s`;
}

export function gateTimeoutMessage(tool: string, ms: number): string {
  return `${tool} 超时 (${formatGateTimeoutLabel(ms)})`;
}

export const GLOBAL_QUALITY_GATE_CONFIG_PATH = GLOBAL_CONFIG_PATH;

export function getRepoQualityGateConfigPath(cwd: string): string {
  return getRepoConfigPath(cwd);
}

function normalizeCoverageThresholdYaml(raw?: number | CoverageThresholdYaml): CoverageThresholdOptions {
  if (typeof raw === 'number') {
    return { lines: raw, functions: raw };
  }
  return {
    lines: raw?.lines ?? DEFAULT_COVERAGE_THRESHOLDS.lines,
    functions: raw?.functions ?? DEFAULT_COVERAGE_THRESHOLDS.functions,
  };
}

export function resolveCoverageThresholds(cwd: string = process.cwd()): CoverageThresholdOptions {
  const config = loadGateConfig(cwd);
  return normalizeCoverageThresholdYaml(config.settings?.coverageThreshold);
}

export interface ResolvedScanScope {
  include: string[];
  exclude: string[];
}

const BUILTIN_SCAN_EXCLUDE = ['_bmad', '_bmad-output', 'node_modules', '.venv', '.claude/worktrees'];

export function resolveScanScope(cwd: string = process.cwd()): ResolvedScanScope {
  const config = loadGateConfig(cwd);
  const yamlExclude = config.settings?.scanScope?.exclude ?? [];
  const include = config.settings?.scanScope?.include ?? [];
  return {
    include: [...include],
    exclude: [...new Set([...BUILTIN_SCAN_EXCLUDE, ...yamlExclude])],
  };
}

export interface ResolvedPushMergeBranchPolicy {
  mode: PushMergeBranchMode;
  include: string[];
  exclude: string[];
}

export function resolvePushMergeBranchPolicy(cwd: string = process.cwd()): ResolvedPushMergeBranchPolicy {
  const config = loadGateConfig(cwd);
  const raw = config.settings?.pushMergeBranches;
  return {
    mode: raw?.mode ?? 'all',
    include: [...(raw?.include ?? [])],
    exclude: [...(raw?.exclude ?? [])],
  };
}

export function resolveLicenseDenylist(cwd: string = process.cwd()): string[] {
  const config = loadGateConfig(cwd);
  return config.settings?.licenseDenylist ?? [];
}

export interface ResolvedNotificationSettings {
  timeoutMs: number;
  cooldownMs: number;
  channels: {
    wechat?: string;
    feishu?: string;
    slack?: string;
  };
}

const DEFAULT_NOTIFICATION_TIMEOUT_MS = 5000;
const DEFAULT_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_END_TRIGGER: SessionEndTrigger = 'session_end';
const DEFAULT_MAX_SUMMARY_CHARS = 1500;

function channelUrl(entry?: NotificationChannelConfig): string | undefined {
  const url = entry?.url?.trim();
  if (!url) return undefined;
  return url;
}

export function getNotificationSettings(cwd: string = process.cwd()): ResolvedNotificationSettings {
  const notifications = loadGateConfig(cwd).settings?.notifications;
  let timeoutMs = DEFAULT_NOTIFICATION_TIMEOUT_MS;
  let cooldownMs = DEFAULT_NOTIFY_COOLDOWN_MS;
  if (notifications?.timeout !== undefined && notifications.timeout !== '') {
    timeoutMs = parseDuration(notifications.timeout);
  }
  if (notifications?.cooldown !== undefined && notifications.cooldown !== '') {
    cooldownMs = parseDuration(notifications.cooldown);
  }
  const channels = notifications?.channels ?? {};
  const resolved: ResolvedNotificationSettings['channels'] = {};
  const wechatUrl = channelUrl(channels.wechat);
  const feishuUrl = channelUrl(channels.feishu);
  const slackUrl = channelUrl(channels.slack);
  if (wechatUrl) resolved.wechat = wechatUrl;
  if (feishuUrl) resolved.feishu = feishuUrl;
  if (slackUrl) resolved.slack = slackUrl;
  return { channels: resolved, timeoutMs, cooldownMs };
}

function parseSessionEndTrigger(value: unknown): SessionEndTrigger | undefined {
  if (value === 'session_end' || value === 'stop' || value === 'both') return value;
  return undefined;
}

function getSessionEndNotifyEntry(config: GateConfig): SessionEndNotifyEntry | undefined {
  return config.ide?.['session-end-notify'];
}

export interface ResolvedSessionEndNotifyConfig {
  enabled: boolean;
  trigger: SessionEndTrigger;
  maxSummaryChars: number;
  timeoutMs: number;
  platformTrigger: SessionEndTrigger;
}

export function resolvePlatformSessionEndTrigger(
  globalTrigger: SessionEndTrigger,
  platform: 'cursor' | 'claude' | 'kiro',
  platformOverride?: SessionEndTrigger,
): SessionEndTrigger {
  let trigger = platformOverride ?? globalTrigger;
  if (platform === 'kiro' && trigger === 'session_end') {
    trigger = 'stop';
  }
  return trigger;
}

export function getSessionEndNotifyConfig(
  cwd: string = process.cwd(),
  platform: 'cursor' | 'claude' | 'kiro' = 'claude',
): ResolvedSessionEndNotifyConfig {
  const path = 'ide.session-end-notify';
  const node = resolveGateNode(path, cwd);
  const config = loadGateConfig(cwd);
  const entry = getSessionEndNotifyEntry(config);
  const globalTrigger = parseSessionEndTrigger(entry?.trigger) ?? DEFAULT_SESSION_END_TRIGGER;
  const platformOverride = parseSessionEndTrigger(entry?.platforms?.[platform]?.trigger);
  const maxSummaryChars =
    typeof entry?.maxSummaryChars === 'number' && entry.maxSummaryChars > 0
      ? Math.round(entry.maxSummaryChars)
      : DEFAULT_MAX_SUMMARY_CHARS;
  const timeoutMs = node.timeoutMs ?? DEFAULT_NOTIFICATION_TIMEOUT_MS;
  return {
    enabled: node.configured && node.enabled,
    trigger: globalTrigger,
    maxSummaryChars,
    timeoutMs,
    platformTrigger: resolvePlatformSessionEndTrigger(globalTrigger, platform, platformOverride),
  };
}

export function getEffectiveSessionEndTrigger(
  platform: 'cursor' | 'claude' | 'kiro',
  cwd: string = process.cwd(),
): SessionEndTrigger {
  return getSessionEndNotifyConfig(cwd, platform).platformTrigger;
}
