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
import { LOG_DIR, getCurrentBranch } from './security-orchestrator.js';
import { readHookInput, formatDenyOutput, formatAllowOutput, isShellHookInput } from './hook-adapter.js';
import { notifySecurityEventAsync } from './notify-security-event.js';
import {
  isGitMergeCommand,
  isGitCommitCommand,
  isProtectedBranch,
  extractBranchDeleteTargets,
  extractRemoteBranchDeleteTargets,
  extractUpdateRefDeleteTargets,
  buildProtectedBranchDeleteDenyReason,
} from './checks/git-policy.js';

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
  // 10a. base64 解码后管道执行
  {
    level: 'high',
    id: 'base64-pipe-sh',
    regex: /\bbase64\b[^\n]*(-d|--decode)[^\n]*\|\s*(ba)?sh\b/,
    reason: 'base64 解码后管道执行（混淆 RCE 风险）',
  },
  // 10b. eval 执行命令替换/反引号
  {
    level: 'high',
    id: 'eval-exec',
    regex: /\beval\b[^\n]*(\$\(|\x60)/,
    reason: 'eval 执行命令替换（RCE 风险）',
  },
  // 10c. sh -c "$(...)" / bash -c `...` 内联远程执行
  {
    level: 'high',
    id: 'sh-c-subshell',
    regex: /\b(ba)?sh\s+-c\s+["']?(\$\(|\x60)/,
    reason: 'sh -c 内联执行命令替换（RCE 风险）',
  },
  // 10d. 下载后执行（curl -o file && sh file）
  {
    level: 'high',
    id: 'download-exec',
    regex: /\b(curl|wget)\b[^\n]*\s-o\s[^\n]*(&&|;|\|)[^\n]*\b(ba)?sh\s+\S/,
    reason: '下载文件后执行（RCE 风险）',
  },
  // 10e. 反弹 shell（/dev/tcp 或 /dev/udp 网络重定向）
  {
    level: 'high',
    id: 'reverse-shell-devtcp',
    regex: /\/dev\/(tcp|udp)\//,
    reason: '反弹 shell（/dev/tcp 网络重定向，RCE 风险）',
  },
  // 10f. netcat 执行程序（nc/ncat -e 或 -c，反弹 shell 常用手法）
  {
    level: 'high',
    id: 'reverse-shell-netcat',
    regex: /\bn(c|cat)\b[^\n]*\s-(e|c)\b/,
    reason: 'netcat 执行程序（反弹 shell 风险）',
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
  // 14a. chmod setuid/setgid（+s 或 4xxx/6xxx 模式）
  {
    level: 'high',
    id: 'chmod-setuid',
    regex: /\bchmod\b[^\n]*(\+s\b|[ugo]\+s|\b[4567][0-7]{3}\b)/,
    reason: 'chmod setuid/setgid 提权风险',
  },
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
  // 19a. podman volume rm
  {
    level: 'high',
    id: 'podman-vol-rm',
    regex: /\bpodman\s+volume\s+(rm|prune)/,
    reason: 'podman volume deletion loses data',
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
  // 22. kubectl get secret
  {
    level: 'high',
    id: 'kubectl-get-secret',
    regex: /\bkubectl\s+get\s+secrets?\b/,
    reason: 'kubectl get secret exposes credentials',
  },
  // 23. kubectl describe secret
  {
    level: 'high',
    id: 'kubectl-describe-secret',
    regex: /\bkubectl\s+describe\s+secrets?\b/,
    reason: 'kubectl describe secret exposes credentials',
  },
  // 24. docker exec print env
  {
    level: 'high',
    id: 'docker-exec-env',
    regex: /\bdocker\s+exec\b.*\b(env|printenv)\b/,
    reason: 'docker exec printing environment variables',
  },
  // 24a. podman exec print env
  {
    level: 'high',
    id: 'podman-exec-env',
    regex: /\bpodman\s+exec\b.*\b(env|printenv)\b/,
    reason: 'podman exec printing environment variables',
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
  // 32a. git config core.hooksPath（持久化绕过 hook）
  {
    level: 'strict',
    id: 'hook-bypass-config',
    regex: /\bgit\s+config\b[^\n]*core\.hooksPath/,
    reason: '禁止通过 git config core.hooksPath 绕过 hook',
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
  // 34b. git push --no-verify
  {
    level: 'strict',
    id: 'push-no-verify',
    regex: /\bgit\s+push\b.*--no-verify/,
    reason: '禁止使用 --no-verify 跳过 push hooks',
  },
  // 34c. git merge --no-verify
  {
    level: 'strict',
    id: 'merge-no-verify',
    regex: /\bgit\s+merge\b.*--no-verify/,
    reason: '禁止使用 --no-verify 跳过 merge hooks',
  },
  // 34d. gh pr merge（绕过本地 merge gate）
  {
    level: 'strict',
    id: 'gh-pr-merge',
    regex: /\bgh\s+pr\s+merge\b/,
    reason: '禁止 gh pr merge，请使用 git merge 以触发本地质量门',
  },
  // 34e. git pull with merge（需本地 merge gate）
  {
    level: 'strict',
    id: 'git-pull-merge',
    regex: /\bgit\s+pull\b(?!.*--rebase)(?!.*--ff-only)/,
    reason: 'git pull 默认 merge 会绕过 pre-merge-commit，请使用 git pull --rebase 或 git fetch + git merge',
  },
  // 34f. git update-ref 删分支（绕过 branch -d；合并判定由 branch-delete-gate 负责）
  {
    level: 'strict',
    id: 'git-update-ref-delete',
    regex: /\bgit\s+update-ref\s+-d\s+refs\/heads\//,
    reason: '禁止通过 git update-ref -d 删除分支，请使用 git branch -d（需 branch-delete-gate 校验已合并）',
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
  // 38a. podman prune
  {
    level: 'strict',
    id: 'podman-prune',
    regex: /\bpodman\s+(system|image)\s+prune/,
    reason: 'podman prune removes images',
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

type PatternLevel = 'critical' | 'high' | 'strict';

const LEVELS: Record<PatternLevel, number> = { critical: 1, high: 2, strict: 3 };
const EMOJIS: Record<PatternLevel, string> = { critical: '🚨', high: '⛔', strict: '⚠️' };

function log(data: Record<string, unknown>) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), hook: 'block-dangerous-commands', ...data }) + '\n',
    );
  } catch {}
}

function isAllowedCommand(cmd: string) {
  if (!cmd) return false;
  return ALLOW_PATTERNS.some((pattern) => pattern.test(cmd));
}

function checkCommand(cmd: string, safetyLevel: string = SAFETY_LEVEL) {
  // 先检查是否为允许的命令
  if (isAllowedCommand(cmd)) {
    return { blocked: false, pattern: null, allowed: true };
  }

  const threshold = LEVELS[safetyLevel as PatternLevel];
  for (const p of PATTERNS) {
    if (LEVELS[p.level as PatternLevel] <= threshold && p.regex.test(cmd)) {
      return { blocked: true, pattern: p, allowed: false };
    }
  }
  return { blocked: false, pattern: null, allowed: false };
}

export interface MergeNoFfCheckResult {
  blocked: boolean;
  id?: 'merge-ff-bypass' | 'merge-squash-bypass';
  reason?: string;
}

const MERGE_IN_PROGRESS = /\bgit\s+merge\b[^\n]*--(?:abort|continue|quit)(?:\s|$)/;

function isCompositeMergeOntoProtectedBranch(cmd: string): boolean {
  return /\bgit\s+(?:checkout|switch)\b[^\n]*\b(main|master)\b[\s\S]*\bgit\s+merge\b/.test(cmd);
}

function isMergeOntoProtectedBranch(cmd: string, cwd?: string): boolean {
  if (isCompositeMergeOntoProtectedBranch(cmd)) return true;
  const branch = getCurrentBranch(cwd ?? process.cwd());
  return branch !== null && isProtectedBranch(branch);
}

export function checkMergeNoFfRequired(cmd: string, cwd?: string): MergeNoFfCheckResult {
  if (!cmd || !isGitMergeCommand(cmd)) {
    return { blocked: false };
  }

  if (MERGE_IN_PROGRESS.test(cmd)) {
    return { blocked: false };
  }

  if (!isMergeOntoProtectedBranch(cmd, cwd)) {
    return { blocked: false };
  }

  if (cmd.includes('--squash')) {
    return {
      blocked: true,
      id: 'merge-squash-bypass',
      reason: 'git merge --squash 不触发 pre-merge-commit。在 main/master 请使用：git merge --no-ff <branch>',
    };
  }

  if (cmd.includes('--no-ff')) {
    return { blocked: false };
  }

  return {
    blocked: true,
    id: 'merge-ff-bypass',
    reason: 'Fast-forward merge 会绕过 pre-merge-commit 全量门。在 main/master 请使用：git merge --no-ff <branch>',
  };
}

export interface MergeConcludeBypassCheckResult {
  blocked: boolean;
  id?: 'merge-conclude-bypass';
  reason?: string;
}

export function checkMergeConcludeBypass(cmd: string, cwd?: string): MergeConcludeBypassCheckResult {
  if (!cmd || !isGitCommitCommand(cmd)) {
    return { blocked: false };
  }
  if (/(?:^|\s)--amend(?:\s|$|=)/.test(cmd)) {
    return { blocked: false };
  }
  const workDir = cwd ?? process.cwd();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- cwd 为 git 仓库根，拼接常量 MERGE_HEAD
  if (!existsSync(join(workDir, '.git', 'MERGE_HEAD'))) {
    return { blocked: false };
  }
  return {
    blocked: true,
    id: 'merge-conclude-bypass',
    reason:
      'git commit 会绕过 pre-merge-commit。请修复问题后执行 git merge --continue（重新触发 full 门），或 git merge --abort 取消合并',
  };
}

export interface ProtectedBranchDeleteCheckResult {
  blocked: boolean;
  id?: 'protected-branch-delete';
  reason?: string;
}

export function checkProtectedBranchDelete(cmd: string): ProtectedBranchDeleteCheckResult {
  const targets = [
    ...extractBranchDeleteTargets(cmd),
    ...extractRemoteBranchDeleteTargets(cmd),
    ...extractUpdateRefDeleteTargets(cmd),
  ];
  for (const branch of targets) {
    if (isProtectedBranch(branch)) {
      return {
        blocked: true,
        id: 'protected-branch-delete',
        reason: buildProtectedBranchDeleteDenyReason(branch),
      };
    }
  }
  return { blocked: false };
}

function denyCustomCheck(
  check: { id?: string; reason?: string },
  cmd: string,
  session_id: string | undefined,
  cwd: string | undefined,
): void {
  const reason = `⚠️ [${check.id ?? 'blocked'}] ${check.reason ?? '命令被阻止'}`;
  log({
    level: 'BLOCKED',
    id: check.id,
    priority: 'strict',
    cmd: cmd.slice(0, 200),
    session_id,
    cwd,
  });
  notifySecurityEventAsync({
    hook: 'block-dangerous-commands',
    severity: 'strict',
    reason,
    ...(session_id ? { session_id } : {}),
  });
  process.stdout.write(`${formatDenyOutput('deny', reason)}\n`);
}

/**
 *
 */
async function main() {
  await (async () => {
    try {
      const data = await readHookInput();
      const { tool_input, session_id, cwd } = data;

      if (!isShellHookInput(data)) {
        console.log(formatAllowOutput());
        return;
      }

      const cmd = tool_input.command ?? '';
      const result = checkCommand(cmd);

      if (result.blocked) {
        const p = result.pattern;
        if (!p) {
          console.log(formatAllowOutput());
          return;
        }
        const reason = `${EMOJIS[p.level as PatternLevel]} [${p.id}] ${p.reason}`;
        log({
          level: 'BLOCKED',
          id: p.id,
          priority: p.level,
          cmd: cmd.slice(0, 200),
          session_id,
          cwd,
        });
        notifySecurityEventAsync({
          hook: 'block-dangerous-commands',
          severity: p.level,
          reason,
          session_id,
        });
        console.log(formatDenyOutput('deny', reason));
        return;
      }

      const mergeCheck = checkMergeNoFfRequired(cmd, cwd);
      if (mergeCheck.blocked) {
        denyCustomCheck(mergeCheck, cmd, session_id, cwd);
        return;
      }

      const mergeConcludeCheck = checkMergeConcludeBypass(cmd, cwd);
      if (mergeConcludeCheck.blocked) {
        denyCustomCheck(mergeConcludeCheck, cmd, session_id, cwd);
        return;
      }

      const protectedDeleteCheck = checkProtectedBranchDelete(cmd);
      if (protectedDeleteCheck.blocked) {
        denyCustomCheck(protectedDeleteCheck, cmd, session_id, cwd);
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
if (import.meta.main) {
  void main();
}

// 导出供测试使用
export { main, log };

// 导出供测试使用
export { PATTERNS, LEVELS, SAFETY_LEVEL, checkCommand, ALLOW_PATTERNS };
