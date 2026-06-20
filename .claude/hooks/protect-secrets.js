#!/usr/bin/env bun
/**
 * Protect Secrets - PreToolUse Hook for Read|Edit|Write|Bash
 * Prevents reading, modifying, or exfiltrating sensitive files.
 * Scans file content for embedded secrets on Write/Edit.
 * Logs to: ~/.claude/hooks-logs/
 *
 * SAFETY_LEVEL: 'critical' | 'high' | 'strict'
 *   critical - SSH keys, AWS creds, .env files only
 *   high     - + secrets files, env dumps, exfiltration attempts
 *   strict   - + database configs, any config that might contain secrets
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, readStdin } from './security-orchestrator.js';
import {
  normalizeInput,
  normalizeFileEditInput,
  formatDenyOutput,
  formatAllowOutput,
  isShellTool,
  getPlatform,
} from './hook-adapter.js';
import { notifySecurityEventAsync } from './notify-security-event.js';

const SAFETY_LEVEL = 'strict';

// Files explicitly safe to access (templates, examples)
const ALLOWLIST = [
  /\.env\.example$/i,
  /\.env\.sample$/i,
  /\.env\.template$/i,
  /\.env\.schema$/i,
  /\.env\.defaults$/i,
  /env\.example$/i,
  /example\.env$/i,
];

// Excluded paths — skip content scanning for these
const EXCLUDE_PATTERNS = [
  /\.env\.example$/i,
  /\.env\.template$/i,
  /\.env\.test$/i,
  /__tests__\//,
  /fixtures\//,
  /node_modules\//,
];

// Sensitive file patterns for Read, Edit, Write tools
const SENSITIVE_FILES = [
  // CRITICAL
  { level: 'critical', id: 'env-file', regex: /(?:^|\/)\.env(?:\.[^/]*)?$/, reason: '.env file contains secrets' },
  { level: 'critical', id: 'envrc', regex: /(?:^|\/)\.envrc$/, reason: '.envrc (direnv) contains secrets' },
  { level: 'critical', id: 'ssh-private-key', regex: /(?:^|\/)\.ssh\/id_[^/]+$/, reason: 'SSH private key' },
  {
    level: 'critical',
    id: 'ssh-private-key-2',
    regex: /(?:^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$/,
    reason: 'SSH private key',
  },
  { level: 'critical', id: 'ssh-authorized', regex: /(?:^|\/)\.ssh\/authorized_keys$/, reason: 'SSH authorized_keys' },
  { level: 'critical', id: 'aws-credentials', regex: /(?:^|\/)\.aws\/credentials$/, reason: 'AWS credentials file' },
  { level: 'critical', id: 'aws-config', regex: /(?:^|\/)\.aws\/config$/, reason: 'AWS config may contain secrets' },
  {
    level: 'critical',
    id: 'kube-config',
    regex: /(?:^|\/)\.kube\/config$/,
    reason: 'Kubernetes config contains credentials',
  },
  { level: 'critical', id: 'pem-key', regex: /\.pem$/i, reason: 'PEM key file' },
  { level: 'critical', id: 'key-file', regex: /\.key$/i, reason: 'Key file' },
  { level: 'critical', id: 'p12-key', regex: /\.(p12|pfx)$/i, reason: 'PKCS12 key file' },
  { level: 'critical', id: 'pub-key', regex: /\.pub$/i, reason: 'Public key file may expose infrastructure details' },
  {
    level: 'critical',
    id: 'tfstate',
    regex: /\.tfstate(?:\.[^/]*)?$/i,
    reason: 'Terraform state file contains infrastructure secrets',
  },
  { level: 'critical', id: 'tfvars', regex: /\.tfvars$/i, reason: 'Terraform variables file may contain secrets' },
  { level: 'critical', id: 'ssh-config', regex: /(?:^|\/)\.ssh\/config$/, reason: 'SSH config file' },

  // HIGH
  { level: 'high', id: 'credentials-json', regex: /(?:^|\/)credentials\.json$/i, reason: 'Credentials file' },
  {
    level: 'high',
    id: 'secrets-file',
    regex: /(?:^|\/)(secrets?|credentials?)\.(json|ya?ml|toml)$/i,
    reason: 'Secrets configuration file',
  },
  { level: 'high', id: 'service-account', regex: /service[_-]?account.*\.json$/i, reason: 'GCP service account key' },
  {
    level: 'high',
    id: 'gcloud-creds',
    regex: /(?:^|\/)\.config\/gcloud\/.*(credentials|tokens)/i,
    reason: 'GCloud credentials',
  },
  {
    level: 'high',
    id: 'azure-creds',
    regex: /(?:^|\/)\.azure\/(credentials|accessTokens)/i,
    reason: 'Azure credentials',
  },
  {
    level: 'high',
    id: 'docker-config',
    regex: /(?:^|\/)\.docker\/config\.json$/,
    reason: 'Docker config may contain registry auth',
  },
  { level: 'high', id: 'netrc', regex: /(?:^|\/)\.netrc$/, reason: '.netrc contains credentials' },
  { level: 'high', id: 'npmrc', regex: /(?:^|\/)\.npmrc$/, reason: '.npmrc may contain auth tokens' },
  { level: 'high', id: 'pypirc', regex: /(?:^|\/)\.pypirc$/, reason: '.pypirc contains PyPI credentials' },
  { level: 'high', id: 'gem-creds', regex: /(?:^|\/)\.gem\/credentials$/, reason: 'RubyGems credentials' },
  { level: 'high', id: 'vault-token', regex: /(?:^|\/)(\.vault-token|vault-token)$/, reason: 'Vault token file' },
  { level: 'high', id: 'keystore', regex: /\.(keystore|jks)$/i, reason: 'Java keystore' },
  { level: 'high', id: 'htpasswd', regex: /(?:^|\/)\.?htpasswd$/, reason: 'htpasswd contains hashed passwords' },
  { level: 'high', id: 'pgpass', regex: /(?:^|\/)\.pgpass$/, reason: 'PostgreSQL password file' },
  { level: 'high', id: 'my-cnf', regex: /(?:^|\/)\.my\.cnf$/, reason: 'MySQL config may contain password' },

  // STRICT
  {
    level: 'strict',
    id: 'database-config',
    regex: /(?:^|\/)(?:config\/)?database\.(json|ya?ml)$/i,
    reason: 'Database config may contain passwords',
  },
  {
    level: 'strict',
    id: 'ssh-known-hosts',
    regex: /(?:^|\/)\.ssh\/known_hosts$/,
    reason: 'SSH known_hosts reveals infrastructure',
  },
  { level: 'strict', id: 'gitconfig', regex: /(?:^|\/)\.gitconfig$/, reason: '.gitconfig may contain credentials' },
  { level: 'strict', id: 'curlrc', regex: /(?:^|\/)\.curlrc$/, reason: '.curlrc may contain auth' },
  {
    level: 'strict',
    id: 'docker-compose-override',
    regex: /(?:^|\/)docker-compose\.override\.ya?ml$/i,
    reason: 'docker-compose.override.yml may contain environment secrets',
  },
];

// Bash patterns that expose or exfiltrate secrets
const BASH_PATTERNS = [
  // CRITICAL
  {
    level: 'critical',
    id: 'cat-env',
    regex: /\b(cat|less|head|tail|more|bat|view)\s+[^|;]*\.env\b/i,
    reason: 'Reading .env file exposes secrets',
  },
  {
    level: 'critical',
    id: 'cat-ssh-key',
    regex: /\b(cat|less|head|tail|more|bat)\s+[^|;]*(id_rsa|id_ed25519|id_ecdsa|id_dsa|\.pem|\.key)\b/i,
    reason: 'Reading private key',
  },
  {
    level: 'critical',
    id: 'cat-aws-creds',
    regex: /\b(cat|less|head|tail|more)\s+[^|;]*\.aws\/credentials/i,
    reason: 'Reading AWS credentials',
  },

  // CRITICAL - Destructive commands
  {
    level: 'critical',
    id: 'rm-recursive-root',
    regex: /\brm\s+[^;&|]*-[a-z]*r[a-z]*f[a-z]*\s+\/(?:\s|$|[*])|\brm\s+[^;&|]*-[a-z]*f[a-z]*r[a-z]*\s+\/(?:\s|$|[*])/,
    reason: 'Recursive force delete on root filesystem',
  },
  {
    level: 'critical',
    id: 'rm-recursive-home',
    regex:
      /\brm\s+[^;&|]*-[a-z]*r[a-z]*f[a-z]*\s+~(?:\/\*)?(?:\s|$)|\brm\s+[^;&|]*-[a-z]*f[a-z]*r[a-z]*\s+~(?:\/\*)?(?:\s|$)/,
    reason: 'Recursive force delete on home directory',
  },
  {
    level: 'critical',
    id: 'dd-disk-wipe',
    regex: /\bdd\s+.*if\s*=\s*\/dev\/(zero|random|urandom)\b/,
    reason: 'dd disk wipe operation (writing from /dev/zero|random|urandom)',
  },
  {
    level: 'critical',
    id: 'fork-bomb',
    regex: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/,
    reason: 'Fork bomb — will crash the system',
  },
  {
    level: 'critical',
    id: 'mkfs-format',
    regex: /\bmkfs\b/,
    reason: 'mkfs formats a filesystem — all data will be destroyed',
  },

  // HIGH - Environment exposure
  {
    level: 'high',
    id: 'env-dump',
    regex: /\bprintenv\b|(?:^|[;&|]\s*)env\s*(?:$|[;&|])/,
    reason: 'Environment dump may expose secrets',
  },
  {
    level: 'high',
    id: 'echo-secret-var',
    regex:
      /\becho\b[^;|&]*\$\{?[A-Za-z_]*(?:SECRET|KEY|TOKEN|PASSWORD|PASSW|CREDENTIAL|API_KEY|AUTH|PRIVATE)[A-Za-z_]*\}?/i,
    reason: 'Echoing secret variable',
  },
  {
    level: 'high',
    id: 'printf-secret-var',
    regex:
      /\bprintf\b[^;|&]*\$\{?[A-Za-z_]*(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|API_KEY|AUTH|PRIVATE)[A-Za-z_]*\}?/i,
    reason: 'Printing secret variable',
  },
  {
    level: 'high',
    id: 'cat-secrets-file',
    regex: /\b(cat|less|head|tail|more)\s+[^|;]*(credentials?|secrets?)\.(json|ya?ml|toml)/i,
    reason: 'Reading secrets file',
  },
  {
    level: 'high',
    id: 'cat-netrc',
    regex: /\b(cat|less|head|tail|more)\s+[^|;]*\.netrc/i,
    reason: 'Reading .netrc credentials',
  },
  {
    level: 'high',
    id: 'source-env',
    regex: /\bsource\s+[^|;]*\.env\b|(?:^|[;&|]\s*)\.\s+[^|;]*\.env\b|^\.\s+[^|;]*\.env\b/i,
    reason: 'Sourcing .env loads secrets',
  },
  {
    level: 'high',
    id: 'export-cat-env',
    regex: /export\s+.*\$\(cat\s+[^)]*\.env/i,
    reason: 'Exporting secrets from .env',
  },

  // HIGH - Exfiltration
  {
    level: 'high',
    id: 'curl-upload-env',
    regex: /\bcurl\b[^;|&]*(-d\s*@|-F\s*[^=]+=@|--data[^=]*=@)[^;|&]*(\.env|credentials|secrets|id_rsa|\.pem|\.key)/i,
    reason: 'Uploading secrets via curl',
  },
  {
    level: 'high',
    id: 'curl-post-secrets',
    regex: /\bcurl\b[^;|&]*-X\s*POST[^;|&]*[^;|&]*(\.env|credentials|secrets)/i,
    reason: 'POSTing secrets via curl',
  },
  {
    level: 'high',
    id: 'wget-post-secrets',
    regex: /\bwget\b[^;|&]*--post-file[^;|&]*(\.env|credentials|secrets)/i,
    reason: 'POSTing secrets via wget',
  },
  {
    level: 'high',
    id: 'scp-secrets',
    regex: /\bscp\b[^;|&]*(\.env|credentials|secrets|id_rsa|\.pem|\.key)[^;|&]+:/i,
    reason: 'Copying secrets via scp',
  },
  {
    level: 'high',
    id: 'rsync-secrets',
    regex: /\brsync\b[^;|&]*(\.env|credentials|secrets|id_rsa)[^;|&]+:/i,
    reason: 'Syncing secrets via rsync',
  },
  {
    level: 'high',
    id: 'nc-secrets',
    regex: /\bnc\b[^;|&]*<[^;|&]*(\.env|credentials|secrets|id_rsa)/i,
    reason: 'Exfiltrating secrets via netcat',
  },

  // HIGH - Copy/move/delete secrets
  { level: 'high', id: 'cp-env', regex: /\bcp\b[^;|&]*\.env\b/i, reason: 'Copying .env file' },
  {
    level: 'high',
    id: 'cp-ssh-key',
    regex: /\bcp\b[^;|&]*(id_rsa|id_ed25519|\.pem|\.key)\b/i,
    reason: 'Copying private key',
  },
  { level: 'high', id: 'mv-env', regex: /\bmv\b[^;|&]*\.env\b/i, reason: 'Moving .env file' },
  {
    level: 'high',
    id: 'rm-ssh-key',
    regex: /\brm\b[^;|&]*(id_rsa|id_ed25519|id_ecdsa|authorized_keys)/i,
    reason: 'Deleting SSH key',
  },
  { level: 'high', id: 'rm-env', regex: /\brm\b.*\.env\b/i, reason: 'Deleting .env file' },
  { level: 'high', id: 'rm-aws-creds', regex: /\brm\b[^;|&]*\.aws\/credentials/i, reason: 'Deleting AWS credentials' },
  {
    level: 'high',
    id: 'truncate-secrets',
    regex: /\btruncate\b.*\.(env|pem|key)\b|(?:^|[;&|]\s*)>\s*\.env\b/i,
    reason: 'Truncating secrets file',
  },

  // HIGH - Process environ
  { level: 'high', id: 'proc-environ', regex: /\/proc\/[^/]*\/environ/, reason: 'Reading process environment' },
  { level: 'high', id: 'xargs-cat-env', regex: /xargs.*cat|\.env.*xargs/i, reason: 'Reading .env via xargs' },
  {
    level: 'high',
    id: 'find-exec-cat-env',
    regex: /find\b.*\.env.*-exec|find\b.*-exec.*(cat|less)/i,
    reason: 'Finding and reading .env files',
  },

  // STRICT
  {
    level: 'strict',
    id: 'grep-password',
    regex: /\bgrep\b[^|;]*(-r|--recursive)[^|;]*(password|secret|api.?key|token|credential)/i,
    reason: 'Grep for secrets may expose them',
  },
  {
    level: 'strict',
    id: 'base64-secrets',
    regex: /\bbase64\b[^|;]*(\.env|credentials|secrets|id_rsa|\.pem)/i,
    reason: 'Base64 encoding secrets',
  },

  // Terraform
  {
    level: 'high',
    id: 'cat-tfstate',
    regex: /\b(cat|less|head|tail|more|bat|view)\s+[^|;]*\.tfstate\b/i,
    reason: 'Reading Terraform state file exposes infrastructure data',
  },
  {
    level: 'high',
    id: 'cp-tfvars',
    regex: /\b(cp|mv)\b[^;|&]*\.tfvars\b/i,
    reason: 'Copying Terraform variables file',
  },
  {
    level: 'high',
    id: 'cat-tfvars',
    regex: /\b(cat|less|head|tail|more|bat|view)\s+[^|;]*\.tfvars\b/i,
    reason: 'Reading Terraform variables file',
  },
];

// Content patterns for scanning file content (Write/Edit)
const CONTENT_PATTERNS = [
  // 信用卡号
  {
    level: 'critical',
    id: 'credit-card-visa',
    regex: /4[0-9]{3}[-\s]?[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{4}/,
    reason: 'Visa 信用卡号',
  },
  {
    level: 'critical',
    id: 'credit-card-mc',
    regex: /5[1-5][0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{4}/,
    reason: 'MasterCard 信用卡号',
  },
  {
    level: 'critical',
    id: 'credit-card-amex',
    regex: /3[47][0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{3}/,
    reason: 'Amex 信用卡号',
  },
  // 中国身份证号（18位）
  {
    level: 'critical',
    id: 'cn-id-card',
    regex: /[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/,
    reason: '中国身份证号 (18位)',
  },
  // AWS
  { level: 'critical', id: 'aws-access-key', regex: /AKIA[0-9A-Z]{16}/, reason: 'AWS Access Key ID' },
  {
    level: 'critical',
    id: 'aws-secret-key',
    regex: /aws_secret_access_key\s*[=:]\s*[A-Za-z0-9\/+=]{40}/i,
    reason: 'AWS Secret Access Key',
  },
  // GitHub Token
  {
    level: 'critical',
    id: 'github-token',
    regex: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    reason: 'GitHub Personal Access Token',
  },
  {
    level: 'critical',
    id: 'github-fine-grained-token',
    regex: /github_pat_[A-Za-z0-9_]{22,}/,
    reason: 'GitHub Fine-grained PAT',
  },
  // API Keys
  { level: 'critical', id: 'gitlab-token', regex: /glpat-[A-Za-z0-9_-]{20,}/, reason: 'GitLab PAT' },
  { level: 'critical', id: 'slack-token', regex: /xox[bporas]-[A-Za-z0-9-]+/, reason: 'Slack Token' },
  { level: 'critical', id: 'stripe-secret', regex: /sk_live_[A-Za-z0-9]+/, reason: 'Stripe Secret Key' },
  { level: 'critical', id: 'google-api-key', regex: /AIza[0-9A-Za-z_-]{35}/, reason: 'Google API Key' },
  {
    level: 'critical',
    id: 'sendgrid-key',
    regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,
    reason: 'SendGrid API Key',
  },
  // 私钥内容
  {
    level: 'critical',
    id: 'private-key-pem',
    regex: /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/,
    reason: 'PEM 私钥内容',
  },
  // 通用 Secret/Token/Password
  {
    level: 'critical',
    id: 'generic-api-key',
    regex: /(api[_-]?key|api[_-]?secret|api[_-]?token)\s*[=:]\s*['"][A-Za-z0-9\/+=_-]{20,}['"]/i,
    reason: '通用 API Key/Secret (硬编码)',
  },
  {
    level: 'high',
    id: 'hardcoded-password',
    regex: /(password|passwd|pwd)\s*[=:]\s*['"][^'"]{8,}['"]/i,
    reason: '硬编码密码',
  },
  {
    level: 'high',
    id: 'generic-secret',
    regex: /(secret|token)\s*[=:]\s*['"][A-Za-z0-9\/+=_-]{16,}['"]/i,
    reason: '硬编码 Secret/Token',
  },
  // 数据库连接字符串
  {
    level: 'critical',
    id: 'db-connection-string',
    regex: /(mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@[^\s]+/i,
    reason: '数据库连接字符串（含凭证）',
  },
  {
    level: 'critical',
    id: 'jdbc-connection-string',
    regex: /jdbc:[a-z]+:\/\/[^\s]+password=[^\s&]+/,
    reason: 'JDBC 连接字符串（含密码）',
  },
  // npm token
  { level: 'critical', id: 'npmrc-auth-token', regex: /_authToken\s*=\s*[A-Za-z0-9_-]+/, reason: 'npm 认证令牌' },
  // Bearer token
  { level: 'high', id: 'bearer-token', regex: /Bearer\s+[A-Za-z0-9\/+=_-]{20,}/, reason: 'Bearer Token（硬编码）' },

  // === API 密钥扫描模式 (Story 1.2) ===
  // OpenAI Project API Key
  {
    level: 'critical',
    id: 'openai-project-key',
    regex: /sk-proj-[A-Za-z0-9]{20,}/,
    reason: 'OpenAI Project API Key',
  },
  // OpenAI Organization API Key
  {
    level: 'critical',
    id: 'openai-org-key',
    regex: /sk-org-[A-Za-z0-9]{20,}/,
    reason: 'OpenAI Organization API Key',
  },
  // Anthropic API Key
  {
    level: 'critical',
    id: 'anthropic-api-key',
    regex: /sk-ant-[A-Za-z0-9]{32,}/,
    reason: 'Anthropic API Key',
  },
  // Hugging Face Token
  {
    level: 'critical',
    id: 'huggingface-token',
    regex: /hf_[A-Za-z0-9]{20,}/,
    reason: 'Hugging Face Access Token',
  },
  // Discord Bot Token
  {
    level: 'critical',
    id: 'discord-bot-token',
    regex: /[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}/,
    reason: 'Discord Bot Token',
  },
  // Telegram Bot Token
  {
    level: 'critical',
    id: 'telegram-bot-token',
    regex: /[0-9]{8,10}:[A-Za-z0-9_-]{35,}/,
    reason: 'Telegram Bot Token',
  },
  // HashiCorp Vault Token
  {
    level: 'critical',
    id: 'vault-token',
    regex: /hvs\.[A-Za-z0-9_-]{20,}/,
    reason: 'HashiCorp Vault Service Token',
  },
  // Datadog API Key
  {
    level: 'critical',
    id: 'datadog-api-key',
    regex: /(?:datadog|DD)_API_KEY\s*[:=]\s*['"]?[a-fA-F0-9]{32}['"]?/i,
    reason: 'Datadog API Key',
  },
  // PagerDuty Token
  {
    level: 'critical',
    id: 'pagerduty-token',
    regex: /p[dt]d_[A-Za-z0-9]{20,}/,
    reason: 'PagerDuty API Token',
  },
  // OpenAI Legacy API Key (经典 sk- 前缀；专用 sk-ant-/sk-proj-/sk-org- 因连字符不会被此模式吞掉)
  {
    level: 'critical',
    id: 'openai-legacy-key',
    regex: /sk-[A-Za-z0-9]{20,}/,
    reason: 'OpenAI Legacy API Key',
  },
];

const LEVELS = { critical: 1, high: 2, strict: 3 };
const EMOJIS = { critical: '🔐', high: '🛡️', strict: '⚠️' };

/** @param {Record<string, unknown>} data */
function log(data) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'protect-secrets', ...data }) + '\n');
  } catch {}
}

/** @param {string} filePath */
function isAllowlisted(filePath) {
  return filePath && ALLOWLIST.some((p) => p.test(filePath));
}

/** @param {string} filePath */
function isExcluded(filePath) {
  return filePath && EXCLUDE_PATTERNS.some((p) => p.test(filePath));
}

/** @param {string} filePath @param {string} [safetyLevel] */
function checkFilePath(filePath, safetyLevel = SAFETY_LEVEL) {
  if (!filePath || isAllowlisted(filePath)) return { blocked: false, pattern: null };
  const threshold = LEVELS[/** @type {keyof typeof LEVELS} */ (safetyLevel)] || 2;
  for (const p of SENSITIVE_FILES) {
    if (LEVELS[/** @type {keyof typeof LEVELS} */ (p.level)] <= threshold && p.regex.test(filePath)) {
      return { blocked: true, pattern: p };
    }
  }
  return { blocked: false, pattern: null };
}

/** @param {string} content @param {string} [safetyLevel] */
function checkContent(content, safetyLevel = SAFETY_LEVEL) {
  if (!content || typeof content !== 'string') return { blocked: false, pattern: null };
  const threshold = LEVELS[/** @type {keyof typeof LEVELS} */ (safetyLevel)] || 2;
  for (const p of CONTENT_PATTERNS) {
    if (LEVELS[/** @type {keyof typeof LEVELS} */ (p.level)] <= threshold && p.regex.test(content)) {
      return { blocked: true, pattern: p };
    }
  }
  return { blocked: false, pattern: null };
}

/** @param {string} cmd @param {string} [safetyLevel] */
function checkBashCommand(cmd, safetyLevel = SAFETY_LEVEL) {
  if (!cmd) return { blocked: false, pattern: null };
  for (const allow of ALLOWLIST) {
    if (allow.test(cmd)) return { blocked: false, pattern: null };
  }
  const threshold = LEVELS[/** @type {keyof typeof LEVELS} */ (safetyLevel)] || 2;
  for (const p of BASH_PATTERNS) {
    if (LEVELS[/** @type {keyof typeof LEVELS} */ (p.level)] <= threshold && p.regex.test(cmd)) {
      return { blocked: true, pattern: p };
    }
  }
  return { blocked: false, pattern: null };
}

/** @param {string} toolName @param {Record<string, unknown>} toolInput @param {string} [safetyLevel] */
function check(toolName, toolInput, safetyLevel = SAFETY_LEVEL) {
  if (toolName === 'Bash') {
    return checkBashCommand(/** @type {string} */ (toolInput?.command), safetyLevel);
  }
  if (toolName === 'Edit' || toolName === 'Write') {
    // Check file path
    const filePath = /** @type {string} */ (toolInput?.file_path);
    const pathResult = checkFilePath(filePath, safetyLevel);
    if (pathResult.blocked) return pathResult;
    // Check content (skip if file is excluded)
    if (filePath && !isExcluded(filePath)) {
      const content = /** @type {string} */ (toolInput?.content || toolInput?.new_string || '');
      if (content) {
        const contentResult = checkContent(content, safetyLevel);
        if (contentResult.blocked) return contentResult;
      }
    }
    return { blocked: false, pattern: null };
  }
  if (toolName === 'Read') {
    return checkFilePath(/** @type {string} */ (toolInput?.file_path), safetyLevel);
  }
  return { blocked: false, pattern: null };
}

async function readProtectSecretsInput() {
  const raw = await readStdin();
  if (getPlatform() === 'cursor' && typeof raw.file_path === 'string' && !raw.tool_name && !raw.toolName) {
    const normalized = normalizeFileEditInput(raw);
    return {
      ...normalized,
      tool_name: 'Read',
      permission_mode: typeof raw.permission_mode === 'string' ? raw.permission_mode : undefined,
    };
  }
  const data = normalizeInput(raw);
  let toolName = data.tool_name;
  if (isShellTool(toolName)) toolName = 'Bash';
  else if (/^write$/i.test(toolName)) toolName = 'Write';
  else if (/^edit$/i.test(toolName)) toolName = 'Edit';
  else if (/^read$/i.test(toolName)) toolName = 'Read';
  return {
    ...data,
    tool_name: toolName,
    permission_mode: typeof raw.permission_mode === 'string' ? raw.permission_mode : undefined,
  };
}

/** @param {string} reason @param {string} [session_id] */
function denyProtectSecrets(reason, session_id) {
  notifySecurityEventAsync({
    hook: 'protect-secrets',
    severity: 'critical',
    reason,
    session_id,
  });
  return formatDenyOutput('deny', reason);
}

async function main() {
  try {
    const data = await readProtectSecretsInput();
    const { tool_name, tool_input, session_id, cwd, permission_mode } = data;

    if (!['Read', 'Edit', 'Write', 'Bash'].includes(tool_name)) {
      return console.log(formatAllowOutput());
    }

    const result = check(tool_name, /** @type {Record<string, unknown>} */ (tool_input));

    if (result.blocked && result.pattern) {
      const p = result.pattern;
      const target = /** @type {string} */ (tool_input?.file_path || tool_input?.command?.slice(0, 100));
      log({ level: 'BLOCKED', id: p.id, priority: p.level, tool: tool_name, target, session_id, cwd, permission_mode });

      const action = { Read: 'read', Edit: 'modify', Write: 'write to', Bash: 'execute' }[
        /** @type {'Read'|'Edit'|'Write'|'Bash'} */ (tool_name)
      ];
      const reason = `${EMOJIS[/** @type {keyof typeof EMOJIS} */ (p.level)]} [${p.id}] Cannot ${action}: ${p.reason}`;
      return console.log(denyProtectSecrets(reason, session_id));
    }
    console.log(formatAllowOutput());
  } catch (e) {
    log({ level: 'ERROR', error: /** @type {Error} */ (e).message });
    console.log(formatAllowOutput());
  }
}

// Only call main() when run directly, not when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  SENSITIVE_FILES,
  BASH_PATTERNS,
  CONTENT_PATTERNS,
  ALLOWLIST,
  EXCLUDE_PATTERNS,
  LEVELS,
  SAFETY_LEVEL,
  check,
  checkFilePath,
  checkBashCommand,
  checkContent,
  isAllowlisted,
  isExcluded,
};
