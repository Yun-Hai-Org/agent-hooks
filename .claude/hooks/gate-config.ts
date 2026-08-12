import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';
import {
  CORE_MODULE_PATHS,
  getHookRootPath,
  getRegistryDefaultTimeoutMs,
  getRegistryNode,
  nodeSupportsAutoFix,
  REGISTRY_COMMIT_TIMEOUT_MS,
  REGISTRY_FULL_TIMEOUT_MS,
  SECURITY_HOOK_IDS,
} from './gate-registry.js';
import type { CoverageThresholdOptions } from './types.js';
import { DEFAULT_COVERAGE_THRESHOLDS } from './checks/coverage.js';

export type SessionEndTrigger = 'session_end' | 'stop' | 'both';
export type GitOperationKind = 'commit' | 'push' | 'merge';

export interface GateConfigEntry {
  enabled?: boolean;
  autoFix?: boolean;
  timeout?: string | number;
  timeoutMs?: number;
  trigger?: SessionEndTrigger;
  maxSummaryChars?: number;
  fallbackOnEmptySummary?: boolean;
  checks?: Record<string, GateConfigEntry>;
  rules?: Record<string, GateConfigEntry>;
  platforms?: Record<string, GateConfigEntry>;
}

export interface NotificationChannelConfig {
  url?: string;
}

export interface OnBlockedNotificationSettings {
  enabled?: boolean;
  excludeHooks?: string[];
}

export interface NotificationSettings {
  timeout?: string | number;
  cooldown?: string | number;
  channels?: {
    wechat?: NotificationChannelConfig;
    feishu?: NotificationChannelConfig;
    slack?: NotificationChannelConfig;
  };
  onBlocked?: OnBlockedNotificationSettings;
}

export type SessionEndNotifyEntry = GateConfigEntry;

export interface GitOperationNotifyEntry extends GateConfigEntry {
  operations?: GitOperationKind[];
}

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

export type CoverageEnforceProfile = 'commit' | 'push';

export interface DiffCoverageThresholdYaml {
  lines?: number;
  enforceOn?: CoverageEnforceProfile[];
  scope?: 'merge-base';
  baseRef?: 'auto' | string;
  include?: string[];
  exclude?: string[];
}

export interface TestFilePairingYaml {
  enabled?: boolean;
  enforceOn?: CoverageEnforceProfile[];
  sourceGlobs?: string[];
  exclude?: string[];
}

export interface CoreModuleCoverageYaml {
  lines?: number;
  functions?: number;
  paths?: string[];
}

export interface SecurityRuleCoverageYaml {
  requiredPercent?: number;
  modules?: string[];
}

export interface WorktreeSettings {
  forbidCreateFromMain?: boolean;
  integratorMergeRequiresFull?: boolean;
}

export interface GateSettings {
  coverageThreshold?: number | CoverageThresholdYaml;
  diffCoverageThreshold?: DiffCoverageThresholdYaml;
  testFilePairing?: TestFilePairingYaml;
  coreModuleCoverage?: CoreModuleCoverageYaml;
  securityRuleCoverage?: SecurityRuleCoverageYaml;
  scanScope?: ScanScopeConfig;
  pushMergeBranches?: PushMergeBranchPolicy;
  forcePrWhenRemote?: boolean;
  worktree?: WorktreeSettings;
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

export function resolveGlobalQualityGateConfigPath(): string {
  return process.env['QUALITY_GATE_GLOBAL_CONFIG_PATH'] ?? GLOBAL_CONFIG_PATH;
}

function readGlobalGateConfig(): GateConfig {
  return readYamlFile(resolveGlobalQualityGateConfigPath());
}

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
    return { lines: override, functions: override };
  }
  const lines = override.lines ?? base.lines;
  const functions = override.functions ?? base.functions;
  const merged: CoverageThresholdYaml = {};
  if (lines !== undefined) merged.lines = lines;
  if (functions !== undefined) merged.functions = functions;
  return merged;
}

function mergeStringArrays(base: string[] | undefined, override: string[] | undefined): string[] | undefined {
  if (!base && !override) return undefined;
  return [...new Set([...(base ?? []), ...(override ?? [])])];
}

function mergeEnforceOn(
  base?: CoverageEnforceProfile[],
  override?: CoverageEnforceProfile[],
): CoverageEnforceProfile[] | undefined {
  if (override !== undefined) return [...override];
  if (base !== undefined) return [...base];
  return undefined;
}

function mergeDiffCoverageThresholdYaml(
  base?: DiffCoverageThresholdYaml,
  override?: DiffCoverageThresholdYaml,
): DiffCoverageThresholdYaml | undefined {
  if (!base) return override ? structuredClone(override) : undefined;
  if (!override) return structuredClone(base);
  const merged: DiffCoverageThresholdYaml = { ...base, ...override };
  const lines = override.lines ?? base.lines;
  if (lines !== undefined) merged.lines = lines;
  const enforceOn = mergeEnforceOn(base.enforceOn, override.enforceOn);
  if (enforceOn !== undefined) merged.enforceOn = enforceOn;
  const include = mergeStringArrays(base.include, override.include);
  if (include !== undefined) merged.include = include;
  const exclude = mergeStringArrays(base.exclude, override.exclude);
  if (exclude !== undefined) merged.exclude = exclude;
  return merged;
}

function mergeTestFilePairingYaml(
  base?: TestFilePairingYaml,
  override?: TestFilePairingYaml,
): TestFilePairingYaml | undefined {
  if (!base) return override ? structuredClone(override) : undefined;
  if (!override) return structuredClone(base);
  const merged: TestFilePairingYaml = { ...base, ...override };
  if (override.enabled !== undefined) merged.enabled = override.enabled;
  const enforceOn = mergeEnforceOn(base.enforceOn, override.enforceOn);
  if (enforceOn !== undefined) merged.enforceOn = enforceOn;
  const sourceGlobs = mergeStringArrays(base.sourceGlobs, override.sourceGlobs);
  if (sourceGlobs !== undefined) merged.sourceGlobs = sourceGlobs;
  const exclude = mergeStringArrays(base.exclude, override.exclude);
  if (exclude !== undefined) merged.exclude = exclude;
  return merged;
}

function mergeCoreModuleCoverageYaml(
  base?: CoreModuleCoverageYaml,
  override?: CoreModuleCoverageYaml,
): CoreModuleCoverageYaml | undefined {
  if (!base) return override ? structuredClone(override) : undefined;
  if (!override) return structuredClone(base);
  const merged: CoreModuleCoverageYaml = { ...base, ...override };
  const lines = override.lines ?? base.lines;
  const functions = override.functions ?? base.functions;
  if (lines !== undefined) merged.lines = lines;
  if (functions !== undefined) merged.functions = functions;
  const paths = mergeStringArrays(base.paths, override.paths);
  if (paths !== undefined) merged.paths = paths;
  return merged;
}

function mergeSecurityRuleCoverageYaml(
  base?: SecurityRuleCoverageYaml,
  override?: SecurityRuleCoverageYaml,
): SecurityRuleCoverageYaml | undefined {
  if (!base) return override ? structuredClone(override) : undefined;
  if (!override) return structuredClone(base);
  const merged: SecurityRuleCoverageYaml = { ...base, ...override };
  const requiredPercent = override.requiredPercent ?? base.requiredPercent;
  if (requiredPercent !== undefined) merged.requiredPercent = requiredPercent;
  const modules = mergeStringArrays(base.modules, override.modules);
  if (modules !== undefined) merged.modules = modules;
  return merged;
}

function mergeSettings(base?: GateSettings, override?: GateSettings): GateSettings {
  if (!base) return structuredClone(override ?? {});
  if (!override) return structuredClone(base);
  const merged: GateSettings = { ...base, ...override };
  const coverageThreshold = mergeCoverageThresholdYaml(base.coverageThreshold, override.coverageThreshold);
  if (coverageThreshold !== undefined) merged.coverageThreshold = coverageThreshold;
  const diffCoverageThreshold = mergeDiffCoverageThresholdYaml(
    base.diffCoverageThreshold,
    override.diffCoverageThreshold,
  );
  if (diffCoverageThreshold !== undefined) merged.diffCoverageThreshold = diffCoverageThreshold;
  const testFilePairing = mergeTestFilePairingYaml(base.testFilePairing, override.testFilePairing);
  if (testFilePairing !== undefined) merged.testFilePairing = testFilePairing;
  const coreModuleCoverage = mergeCoreModuleCoverageYaml(base.coreModuleCoverage, override.coreModuleCoverage);
  if (coreModuleCoverage !== undefined) merged.coreModuleCoverage = coreModuleCoverage;
  const securityRuleCoverage = mergeSecurityRuleCoverageYaml(base.securityRuleCoverage, override.securityRuleCoverage);
  if (securityRuleCoverage !== undefined) merged.securityRuleCoverage = securityRuleCoverage;
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
  if (base.worktree || override.worktree) {
    const worktree: WorktreeSettings = {};
    const forbidCreateFromMain = override.worktree?.forbidCreateFromMain ?? base.worktree?.forbidCreateFromMain;
    const integratorMergeRequiresFull =
      override.worktree?.integratorMergeRequiresFull ?? base.worktree?.integratorMergeRequiresFull;
    if (forbidCreateFromMain !== undefined) worktree.forbidCreateFromMain = forbidCreateFromMain;
    if (integratorMergeRequiresFull !== undefined) worktree.integratorMergeRequiresFull = integratorMergeRequiresFull;
    merged.worktree = worktree;
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
  if (base.onBlocked || override.onBlocked) {
    merged.onBlocked = {
      ...base.onBlocked,
      ...override.onBlocked,
      excludeHooks: mergeStringArrays(base.onBlocked?.excludeHooks, override.onBlocked?.excludeHooks),
    };
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
  const globalPath = resolveGlobalQualityGateConfigPath();
  const mtimeGlobal = getFileMtime(globalPath);
  const mtimeRepo = getFileMtime(repoPath);
  const cached = configCache.get(cwd);
  if (cached?.mtimeGlobal === mtimeGlobal && cached.mtimeRepo === mtimeRepo) {
    return cached.merged;
  }
  const merged = deepMergeConfig(readGlobalGateConfig(), readYamlFile(repoPath));
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

const BUILTIN_SCAN_EXCLUDE = [
  '_bmad',
  '_bmad-output',
  'node_modules',
  '.venv',
  '.claude/worktrees',
  '.worktrees',
  'data/evals',
];

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

export function resolveForcePrWhenRemote(cwd: string = process.cwd()): boolean {
  const config = loadGateConfig(cwd);
  const raw = config.settings?.forcePrWhenRemote;
  return raw ?? true;
}

export interface ResolvedWorktreeSettings {
  forbidCreateFromMain: boolean;
  integratorMergeRequiresFull: boolean;
}

export function resolveWorktreeSettings(cwd: string = process.cwd()): ResolvedWorktreeSettings {
  const config = loadGateConfig(cwd);
  const raw = config.settings?.worktree;
  return {
    forbidCreateFromMain: raw?.forbidCreateFromMain ?? true,
    integratorMergeRequiresFull: raw?.integratorMergeRequiresFull ?? false,
  };
}

export function resolveLicenseDenylist(cwd: string = process.cwd()): string[] {
  const config = loadGateConfig(cwd);
  return config.settings?.licenseDenylist ?? [];
}

const DEFAULT_DIFF_COVERAGE_LINES = 80;
const DEFAULT_DIFF_COVERAGE_ENFORCE_ON: CoverageEnforceProfile[] = ['push'];
const DEFAULT_DIFF_COVERAGE_SCOPE = 'merge-base';
const DEFAULT_DIFF_COVERAGE_BASE_REF = 'auto';
const DEFAULT_DIFF_COVERAGE_INCLUDE = ['.claude/hooks/**', 'scripts/lib/**', 'scripts/cursor-yingmi-hooks/**'];
const DEFAULT_DIFF_COVERAGE_EXCLUDE = ['**/*.test.ts', '**/__tests__/**', '**/*.d.ts', 'tests/**'];

export interface ResolvedDiffCoverageThreshold {
  lines: number;
  enforceOn: CoverageEnforceProfile[];
  scope: string;
  baseRef: string;
  include: string[];
  exclude: string[];
}

export function resolveDiffCoverageThreshold(cwd: string = process.cwd()): ResolvedDiffCoverageThreshold {
  const raw = loadGateConfig(cwd).settings?.diffCoverageThreshold;
  return {
    lines: raw?.lines ?? DEFAULT_DIFF_COVERAGE_LINES,
    enforceOn: raw?.enforceOn?.length ? [...raw.enforceOn] : [...DEFAULT_DIFF_COVERAGE_ENFORCE_ON],
    scope: raw?.scope ?? DEFAULT_DIFF_COVERAGE_SCOPE,
    baseRef: raw?.baseRef ?? DEFAULT_DIFF_COVERAGE_BASE_REF,
    include: raw?.include?.length ? [...raw.include] : [...DEFAULT_DIFF_COVERAGE_INCLUDE],
    exclude: raw?.exclude?.length ? [...raw.exclude] : [...DEFAULT_DIFF_COVERAGE_EXCLUDE],
  };
}

export function isDiffCoverageEnforcedFor(profile: CoverageEnforceProfile, cwd: string = process.cwd()): boolean {
  return resolveDiffCoverageThreshold(cwd).enforceOn.includes(profile);
}

const DEFAULT_TEST_FILE_PAIRING_ENFORCE_ON: CoverageEnforceProfile[] = ['commit'];
const DEFAULT_TEST_FILE_PAIRING_SOURCE_GLOBS = [
  '.claude/hooks/**/*.ts',
  'scripts/lib/**/*.py',
  'scripts/cursor-yingmi-hooks/**/*.sh',
];
const DEFAULT_TEST_FILE_PAIRING_EXCLUDE = ['**/*.d.ts', '**/__tests__/**', '**/native/run-*.ts'];

export interface ResolvedTestFilePairingConfig {
  enabled: boolean;
  enforceOn: CoverageEnforceProfile[];
  sourceGlobs: string[];
  exclude: string[];
}

export function resolveTestFilePairingConfig(cwd: string = process.cwd()): ResolvedTestFilePairingConfig {
  const raw = loadGateConfig(cwd).settings?.testFilePairing;
  return {
    enabled: raw?.enabled ?? true,
    enforceOn: raw?.enforceOn?.length ? [...raw.enforceOn] : [...DEFAULT_TEST_FILE_PAIRING_ENFORCE_ON],
    sourceGlobs: raw?.sourceGlobs?.length ? [...raw.sourceGlobs] : [...DEFAULT_TEST_FILE_PAIRING_SOURCE_GLOBS],
    exclude: raw?.exclude?.length ? [...raw.exclude] : [...DEFAULT_TEST_FILE_PAIRING_EXCLUDE],
  };
}

const DEFAULT_CORE_MODULE_COVERAGE_LINES = 90;
const DEFAULT_CORE_MODULE_COVERAGE_FUNCTIONS = 90;

export interface ResolvedCoreModuleCoverageConfig {
  lines: number;
  functions: number;
  paths: string[];
}

export function resolveCoreModuleCoverageConfig(cwd: string = process.cwd()): ResolvedCoreModuleCoverageConfig {
  const raw = loadGateConfig(cwd).settings?.coreModuleCoverage;
  const paths = raw?.paths?.length ? [...raw.paths] : [...CORE_MODULE_PATHS];
  return {
    lines: raw?.lines ?? DEFAULT_CORE_MODULE_COVERAGE_LINES,
    functions: raw?.functions ?? DEFAULT_CORE_MODULE_COVERAGE_FUNCTIONS,
    paths,
  };
}

const DEFAULT_SECURITY_RULE_REQUIRED_PERCENT = 100;

export interface ResolvedSecurityRuleCoverageConfig {
  requiredPercent: number;
  modules: string[];
}

export function resolveSecurityRuleCoverageConfig(cwd: string = process.cwd()): ResolvedSecurityRuleCoverageConfig {
  const raw = loadGateConfig(cwd).settings?.securityRuleCoverage;
  const modules = raw?.modules?.length ? [...raw.modules] : [...SECURITY_HOOK_IDS];
  return {
    requiredPercent: raw?.requiredPercent ?? DEFAULT_SECURITY_RULE_REQUIRED_PERCENT,
    modules,
  };
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

export interface ResolvedOnBlockedNotificationSettings {
  enabled: boolean;
  excludeHooks: Set<string>;
}

const DEFAULT_ON_BLOCKED_EXCLUDE = [
  'workflow-gate',
  'workflow-stop-gate',
  'orchestrator-gate',
  'branch-gate',
  'block-dangerous-commands',
  'protect-secrets',
  'hooks-doctor',
] as const;

const DEFAULT_NOTIFICATION_TIMEOUT_MS = 5000;
const DEFAULT_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_END_TRIGGER: SessionEndTrigger = 'session_end';
const DEFAULT_MAX_SUMMARY_CHARS = 1500;

function channelUrl(entry?: NotificationChannelConfig): string | undefined {
  const url = entry?.url?.trim();
  if (!url) return undefined;
  return url;
}

const CHANNEL_ENV_VARS: Record<'wechat' | 'feishu' | 'slack', string> = {
  wechat: 'WECOM_WEBHOOK_URL',
  feishu: 'FEISHU_WEBHOOK_URL',
  slack: 'SLACK_WEBHOOK_URL',
};

function resolveChannelUrl(
  channel: 'wechat' | 'feishu' | 'slack',
  entry?: NotificationChannelConfig,
): string | undefined {
  const fromYaml = channelUrl(entry);
  if (fromYaml) return fromYaml;
  const fromEnv = process.env[CHANNEL_ENV_VARS[channel]]?.trim();
  return fromEnv || undefined;
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
  const wechatUrl = resolveChannelUrl('wechat', channels.wechat);
  const feishuUrl = resolveChannelUrl('feishu', channels.feishu);
  const slackUrl = resolveChannelUrl('slack', channels.slack);
  if (wechatUrl) resolved.wechat = wechatUrl;
  if (feishuUrl) resolved.feishu = feishuUrl;
  if (slackUrl) resolved.slack = slackUrl;
  return { channels: resolved, timeoutMs, cooldownMs };
}

export function getOnBlockedNotificationSettings(cwd: string = process.cwd()): ResolvedOnBlockedNotificationSettings {
  const onBlocked = loadGateConfig(cwd).settings?.notifications?.onBlocked;
  const excludeHooks = new Set<string>([...DEFAULT_ON_BLOCKED_EXCLUDE, ...(onBlocked?.excludeHooks ?? [])]);
  return {
    enabled: onBlocked?.enabled !== false,
    excludeHooks,
  };
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
  fallbackOnEmptySummary: boolean;
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
  const fallbackOnEmptySummary = entry?.fallbackOnEmptySummary !== false;
  return {
    enabled: node.configured && node.enabled,
    trigger: globalTrigger,
    maxSummaryChars,
    timeoutMs,
    platformTrigger: resolvePlatformSessionEndTrigger(globalTrigger, platform, platformOverride),
    fallbackOnEmptySummary,
  };
}

export function getEffectiveSessionEndTrigger(
  platform: 'cursor' | 'claude' | 'kiro',
  cwd: string = process.cwd(),
): SessionEndTrigger {
  return getSessionEndNotifyConfig(cwd, platform).platformTrigger;
}

const DEFAULT_GIT_OPERATIONS: GitOperationKind[] = ['commit', 'push', 'merge'];

function parseGitOperationKind(value: unknown): GitOperationKind | undefined {
  if (value === 'commit' || value === 'push' || value === 'merge') return value;
  return undefined;
}

function getGitOperationNotifyEntry(config: GateConfig): GitOperationNotifyEntry | undefined {
  return config.git?.['git-operation-notify'];
}

export interface ResolvedGitOperationNotifyConfig {
  enabled: boolean;
  operations: GitOperationKind[];
  timeoutMs: number;
  maxSummaryChars: number;
}

export function getGitOperationNotifyConfig(cwd: string = process.cwd()): ResolvedGitOperationNotifyConfig {
  const path = 'git.git-operation-notify';
  const node = resolveGateNode(path, cwd);
  const config = loadGateConfig(cwd);
  const entry = getGitOperationNotifyEntry(config);
  const operationsRaw = entry?.operations;
  const operations =
    Array.isArray(operationsRaw) && operationsRaw.length > 0
      ? operationsRaw.map(parseGitOperationKind).filter((op): op is GitOperationKind => op !== undefined)
      : DEFAULT_GIT_OPERATIONS;
  const timeoutMs = node.timeoutMs ?? DEFAULT_NOTIFICATION_TIMEOUT_MS;
  const registryHasHook = getRegistryNode(path) !== undefined;
  const explicitlyDisabled = entry?.enabled === false;
  let enabled: boolean;
  if (explicitlyDisabled) {
    enabled = false;
  } else if (node.configured) {
    enabled = true;
  } else {
    enabled = registryHasHook;
  }
  return {
    enabled,
    operations: operations.length > 0 ? operations : DEFAULT_GIT_OPERATIONS,
    timeoutMs,
    maxSummaryChars: DEFAULT_MAX_SUMMARY_CHARS,
  };
}
