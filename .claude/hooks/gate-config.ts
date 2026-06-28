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

export interface GateConfigEntry {
  enabled?: boolean;
  autoFix?: boolean;
  timeout?: string | number;
  timeoutMs?: number;
  checks?: Record<string, GateConfigEntry>;
  rules?: Record<string, GateConfigEntry>;
}

export interface GateConfig {
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
