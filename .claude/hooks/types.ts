export const DECISION_VALUES = {
  ALLOW: 'allow',
  DENY: 'deny',
  WARN: 'warn',
  SKIP: 'skip',
} as const;

export type Decision = (typeof DECISION_VALUES)[keyof typeof DECISION_VALUES];

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export const SEVERITY_VALUES = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'moderate',
  LOW: 'low',
  INFO: 'info',
} as const;

export type Severity = (typeof SEVERITY_VALUES)[keyof typeof SEVERITY_VALUES];

export interface CheckResult {
  checkId: string;
  decision: Decision;
  message: string;
  timestamp?: string;
  details?: Record<string, unknown>;
  durationMs?: number;
  controlIds?: string[];
}

export interface DecideResult {
  decision: Decision;
  reason: string;
  denyResults: CheckResult[];
  warnResults: CheckResult[];
}

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface ToolAvailability {
  available: boolean;
  message?: string;
}

export interface ToolchainInfo {
  js: string | null;
  python: string | null;
}

export type HookPlatform = 'claude' | 'cursor' | 'kiro';

export interface HookToolInput {
  command?: string;
  file_path?: string;
  content?: string;
  new_string?: string;
}

export interface HookInput {
  tool_name: string;
  tool_input: HookToolInput;
  session_id: string;
  cwd: string;
}

export type QualityGateProfile = 'commit' | 'full';

export interface QualityGateDecision {
  decision: Decision;
  reason?: string;
}

export interface GateTimingEntry {
  checkId: string;
  ms: number;
}

export interface GateTiming {
  maxMs: number;
  avgMs: number;
  slowest: GateTimingEntry | null;
  perCheck: GateTimingEntry[];
}

export interface QualityGateResult {
  passed: boolean;
  results: CheckResult[];
  decision: QualityGateDecision;
  timing: GateTiming;
}

export interface ExecErrorLike {
  stdout?: string;
  stderr?: string;
  message?: string;
}

export function isExecErrorLike(error: unknown): error is ExecErrorLike {
  return typeof error === 'object' && error !== null;
}

export function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export interface ToolStatus {
  name: string;
  available: boolean;
  version: string;
}

export interface NotificationEvent {
  hook: string;
  severity: string;
  reason: string;
  projectName?: string;
  platform?: string;
  sessionId?: string;
}

export interface NotificationChannel {
  name: string;
  url: string;
  formatFn: (event: NotificationEvent, timestamp: string) => Record<string, unknown>;
}

export type GatePendingType = 'push' | 'merge';

export interface GatePendingEntry {
  type: GatePendingType;
  command: string;
  cwd: string;
  sourceBranch?: string;
  ts?: number;
}

export interface GateFixOptions {
  loopCount?: number;
  pendingType?: string;
}

export interface HadolintIssue {
  file: string;
  line: number;
  severity: string;
  ruleId: string;
  message: string;
}

export type GatePathPrefix = 'git.pre-commit' | 'git.pre-push' | 'git.pre-merge-commit';

export interface CoverageThresholdOptions {
  lines: number;
  functions: number;
}

export interface GateCheckRunOptions {
  timeoutMs?: number | undefined;
  gatePathPrefix?: GatePathPrefix | undefined;
  staged?: boolean | undefined;
  base?: string | undefined;
  coverageThreshold?: CoverageThresholdOptions | undefined;
  coverageReport?: string | undefined;
}

export function spreadTimeoutMs(timeoutMs?: number): Pick<GateCheckRunOptions, 'timeoutMs'> {
  return timeoutMs !== undefined ? { timeoutMs } : {};
}

export function spreadGateCheckOptions(timeoutMs?: number, gatePathPrefix?: GatePathPrefix): GateCheckRunOptions {
  return { ...spreadTimeoutMs(timeoutMs), ...(gatePathPrefix !== undefined ? { gatePathPrefix } : {}) };
}

export interface QualityGateParseOptions {
  profile: QualityGateProfile;
  cwd: string;
  json: boolean;
  commitCmd?: string;
  commitMsgFile?: string;
}

export interface AutoCommitOptions {
  loopCount?: number;
  sessionId?: string;
}
