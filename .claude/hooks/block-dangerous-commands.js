#!/usr/bin/env bun
/**
 * Block Dangerous Commands - PreToolUse Hook for Bash
 * 阻止危险命令和工具限制
 *
 * 规则分类：
 * 1-9:   CRITICAL - 灾难性命令
 * 10-21: HIGH - 高风险命令
 * 22-24: STRICT - 工具限制和 Hook 绕过防护
 *
 * SAFETY_LEVEL: 'critical' | 'high' | 'strict'
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { LOG_DIR } from './security-orchestrator.js';
import { readHookInput, formatDenyOutput, formatAllowOutput, isShellHookInput } from './hook-adapter.js';

const SAFETY_LEVEL = 'strict';

const PATTERNS = [
  // ==================== CRITICAL - 灾难性命令 ====================
  // 1. rm -rf ~
  {
    level: 'critical',
    id: 'rm-home',
    regex: /\brm\s+(-.+\s+)*["']?~\/?["']?(\s|$|[;&|])/,
    reason: 'rm targeting home directory',
  },
  // 2. rm -rf $HOME
  {
    level: 'critical',
    id: 'rm-home-var',
    regex: /\brm\s+(-.+\s+)*["']?\$HOME["']?(\s|$|[;&|])/,
    reason: 'rm targeting $HOME',
  },
  // 3. rm with trailing ~/
  {
    level: 'critical',
    id: 'rm-home-trailing',
    regex: /\brm\s+.+\s+["']?(~\/?|\$HOME)["']?(\s*$|[;&|])/,
    reason: 'rm with trailing ~/ or $HOME',
  },
  // 4. rm -rf /
  {
    level: 'critical',
    id: 'rm-root',
    regex: /\brm\s+(-.+\s+)*\/(\*|\s|$|[;&|])/,
    reason: 'rm targeting root filesystem',
  },
  // 5. rm system dirs
  {
    level: 'critical',
    id: 'rm-system',
    regex: /\brm\s+(-.+\s+)*\/(etc|usr|var|bin|sbin|lib|boot|dev|proc|sys)(\/|\s|$)/,
    reason: 'rm targeting system directory',
  },
  // 6. rm ./*
  {
    level: 'critical',
    id: 'rm-cwd',
    regex: /\brm\s+(-.+\s+)*(\.\/?|\*|\.\/\*)(\s|$|[;&|])/,
    reason: 'rm deleting current directory contents',
  },
  // 7. dd to disk
  {
    level: 'critical',
    id: 'dd-disk',
    regex: /\bdd\b.+of=\/dev\/(sd[a-z]|nvme|hd[a-z]|vd[a-z]|xvd[a-z])/,
    reason: 'dd writing to disk device',
  },
  // 8. mkfs
  {
    level: 'critical',
    id: 'mkfs',
    regex: /\bmkfs(\.\w+)?\s+\/dev\/(sd[a-z]|nvme|hd[a-z]|vd[a-z])/,
    reason: 'mkfs formatting disk',
  },
  // 9. fork bomb
  { level: 'critical', id: 'fork-bomb', regex: /:\(\)\s*\{.*:\s*\|\s*:.*&/, reason: 'fork bomb detected' },

  // ==================== HIGH - 高风险命令 ====================
  // 10. curl|sh
  {
    level: 'high',
    id: 'curl-pipe-sh',
    regex: /\b(curl|wget)\b.+\|\s*(ba)?sh\b/,
    reason: 'piping URL to shell (RCE risk)',
  },
  // 11. git push --force main/master
  {
    level: 'high',
    id: 'git-force-main',
    regex: /\bgit\s+push\b(?!.+--force-with-lease).+(--force|-f)\b.+\b(main|master)\b/,
    reason: 'force push to main/master',
  },
  // 12. git reset --hard
  {
    level: 'high',
    id: 'git-reset-hard',
    regex: /\bgit\s+reset\s+--hard/,
    reason: 'git reset --hard loses uncommitted work',
  },
  // 13. git clean -f
  {
    level: 'high',
    id: 'git-clean-f',
    regex: /\bgit\s+clean\s+(-\w*f|-f)/,
    reason: 'git clean -f deletes untracked files',
  },
  // 14. chmod 777
  { level: 'high', id: 'chmod-777', regex: /\bchmod\b.+\b777\b/, reason: 'chmod 777 is a security risk' },
  // 15. cat .env
  {
    level: 'high',
    id: 'cat-env',
    regex: /\b(cat|less|head|tail|more)\s+\.env\b/,
    reason: 'reading .env file exposes secrets',
  },
  // 16. cat secrets
  {
    level: 'high',
    id: 'cat-secrets',
    regex: /\b(cat|less|head|tail|more)\b.+(credentials|secrets?|\.pem|\.key|id_rsa|id_ed25519)/i,
    reason: 'reading secrets file',
  },
  // 17. env dump
  { level: 'high', id: 'env-dump', regex: /\b(printenv|^env)\s*([;&|]|$)/, reason: 'env dump may expose secrets' },
  // 18. echo secret
  {
    level: 'high',
    id: 'echo-secret',
    regex: /\becho\b.+\$\w*(SECRET|KEY|TOKEN|PASSWORD|API_|PRIVATE)/i,
    reason: 'echoing secret variable',
  },
  // 19. docker volume rm
  {
    level: 'high',
    id: 'docker-vol-rm',
    regex: /\bdocker\s+volume\s+(rm|prune)/,
    reason: 'docker volume deletion loses data',
  },
  // 20. rm ssh keys
  {
    level: 'high',
    id: 'rm-ssh',
    regex: /\brm\b.+\.ssh\/(id_|authorized_keys|known_hosts)/,
    reason: 'deleting SSH keys',
  },
  // 21. git push --force-with-lease main/master
  {
    level: 'high',
    id: 'git-force-lease-main',
    regex: /\bgit\s+push\b.+--force-with-lease.*\b(main|master)\b/,
    reason: '禁止 force push 到 main/master',
  },

  // ==================== STRICT - 工具限制 ====================
  // 23. pip install/uninstall
  { level: 'strict', id: 'pip-install', regex: /\bpip3?\s+(install|uninstall)\b/, reason: '请使用 uv add / uv remove' },
  // 24. npm install/i/uninstall
  {
    level: 'strict',
    id: 'npm-install',
    regex: /\bnpm\s+(install|i|uninstall)\b/,
    reason: '请使用 bun add / bun remove',
  },
  // 25. npm ci
  { level: 'strict', id: 'npm-ci', regex: /\bnpm\s+ci\b/, reason: '请使用 bun install --frozen-lockfile' },
  // 26. pnpm install/add
  { level: 'strict', id: 'pnpm-install', regex: /\bpnpm\s+(install|add)\b/, reason: '请使用 bun add' },
  // 27. yarn install/add
  { level: 'strict', id: 'yarn-install', regex: /\byarn\s+(install|add)\b/, reason: '请使用 bun add' },
  // 28. npx
  { level: 'strict', id: 'npx', regex: /\bnpx\s+/, reason: '请使用 bunx' },
  // 29. python <script>
  {
    level: 'strict',
    id: 'python-script',
    regex: /\bpython\s+[^-\s][^\s]*\.py\b/,
    reason: '请使用 uv run python <script.py>',
  },
  // 30. python3 <script>
  {
    level: 'strict',
    id: 'python3-script',
    regex: /\bpython3\s+[^-\s][^\s]*\.py\b/,
    reason: '请使用 uv run python <script.py>',
  },
  // 31. node <script>
  { level: 'strict', id: 'node-script', regex: /\bnode\s+[^-\s][^\s]*\.js\b/, reason: '请使用 bun <script.js>' },

  // ==================== STRICT - Hook 绕过防护 ====================
  // 32. git -c core.hooksPath=...
  {
    level: 'strict',
    id: 'hook-bypass-path',
    regex: /\bgit\b.*-c\s+core\.hooksPath=/,
    reason: '禁止通过 core.hooksPath 绕过 hook',
  },
  // 33. git commit --no-verify
  {
    level: 'strict',
    id: 'no-verify',
    regex: /\bgit\s+commit\b.*--no-verify/,
    reason: '禁止使用 --no-verify 跳过 hooks',
  },
  // 34. git commit -n
  {
    level: 'strict',
    id: 'no-verify-short',
    regex: /\bgit\s+commit\b.*\s-n\b/,
    reason: '禁止使用 -n(--no-verify) 跳过 commit hooks',
  },

  // ==================== STRICT - 分支操作（非阻止） ====================
  // 35. git force push any (非 main/master)
  {
    level: 'strict',
    id: 'git-force-any',
    regex: /\bgit\s+push\b(?!.+--force-with-lease).+(--force|-f)\b/,
    reason: 'force push (use --force-with-lease)',
  },
  // 36. git checkout .
  {
    level: 'strict',
    id: 'git-checkout-dot',
    regex: /\bgit\s+checkout\s+\./,
    reason: 'git checkout . discards changes',
  },
  // 37. sudo rm
  { level: 'strict', id: 'sudo-rm', regex: /\bsudo\s+rm\b/, reason: 'sudo rm has elevated privileges' },
  // 38. docker prune
  {
    level: 'strict',
    id: 'docker-prune',
    regex: /\bdocker\s+(system|image)\s+prune/,
    reason: 'docker prune removes images',
  },
  // 39. crontab -r
  { level: 'strict', id: 'crontab-r', regex: /\bcrontab\s+-r/, reason: 'removes all cron jobs' },
];

// 允许的查询操作（不阻止）
const ALLOW_PATTERNS = [
  /\bpython3?\s+--version\b/,
  /\bwhich\s+python3?\b/,
  /\bnode\s+--version\b/,
  /\bwhich\s+node\b/,
  /\bbun\s+--version\b/,
  /\buv\s+--version\b/,
  /\bgit\s+checkout\s+(main|master)\b/, // 切换到主分支本身不阻止
];

const LEVELS = /** @type {{ [key: string]: number }} */ ({ critical: 1, high: 2, strict: 3 });
const EMOJIS = /** @type {{ [key: string]: string }} */ ({ critical: '🚨', high: '⛔', strict: '⚠️' });

/** @param {Record<string, unknown>} data */
function log(data) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), hook: 'block-dangerous-commands', ...data }) + '\n',
    );
  } catch {}
}

/** @param {string} cmd */
function isAllowedCommand(cmd) {
  if (!cmd) return false;
  return ALLOW_PATTERNS.some((pattern) => pattern.test(cmd));
}

/** @param {string} cmd @param {string} [safetyLevel] */
function checkCommand(cmd, safetyLevel = SAFETY_LEVEL) {
  // 先检查是否为允许的命令
  if (isAllowedCommand(cmd)) {
    return { blocked: false, pattern: null, allowed: true };
  }

  const threshold = LEVELS[safetyLevel] || 2;
  for (const p of PATTERNS) {
    if (LEVELS[p.level] <= threshold && p.regex.test(cmd)) {
      return { blocked: true, pattern: p, allowed: false };
    }
  }
  return { blocked: false, pattern: null, allowed: false };
}

async function main() {
  await (async () => {
    try {
      const data = await readHookInput();
      const { tool_input, session_id, cwd } = data;

      if (!isShellHookInput(data)) {
        console.log(formatAllowOutput());
        return;
      }

      const cmd = tool_input?.command || '';
      const result = checkCommand(cmd);

      if (result.blocked) {
        const p = result.pattern;
        if (!p) {
          console.log(formatAllowOutput());
          return;
        }
        const reason = `${EMOJIS[p.level]} [${p.id}] ${p.reason}`;
        log({
          level: 'BLOCKED',
          id: p.id,
          priority: p.level,
          cmd: cmd.slice(0, 200),
          session_id,
          cwd,
        });
        console.log(formatDenyOutput('deny', reason));
        return;
      }

      console.log(formatAllowOutput());
    } catch (/** @type {unknown} */ e) {
      log({ level: 'ERROR', error: e instanceof Error ? e.message : String(e) });
      console.log(formatAllowOutput());
    }
  })();
}

// 只在直接运行时执行 main，导入时不执行
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// 导出供测试使用
export { main, log };

// 导出供测试使用
export { PATTERNS, LEVELS, SAFETY_LEVEL, checkCommand, ALLOW_PATTERNS };
