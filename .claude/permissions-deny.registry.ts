/**
 * Claude Code permissions.deny SSOT — maps hook rules to permission deny patterns.
 * hookOnly entries are enforced by hooks only (contextual gates, regex complexity).
 */

import { BLOCK_DANGEROUS_RULE_IDS } from './hooks/gate-registry.js';

export type PermissionDenySource =
  | 'block-dangerous-commands'
  | 'protect-secrets'
  | 'branch-delete-gate'
  | 'branch-gate'
  | 'workflow-gate';

export type PermissionDenyEntry = {
  id: string;
  /** Claude permission rule like "Bash(rm -rf /)" — omit if hookOnly */
  rule?: string;
  source: PermissionDenySource;
  hookOnly?: boolean;
  reason?: string;
};

function bash(id: string, rule: string, reason?: string): PermissionDenyEntry {
  return { id, rule: `Bash(${rule})`, source: 'block-dangerous-commands', reason };
}

function hookOnly(id: string, source: PermissionDenySource, reason?: string): PermissionDenyEntry {
  return { id, source, hookOnly: true, reason };
}

function sensitivePath(id: string, pattern: string, reason: string): PermissionDenyEntry[] {
  return [
    { id, rule: `Read(${pattern})`, source: 'protect-secrets', reason },
    { id, rule: `Edit(${pattern})`, source: 'protect-secrets', reason },
  ];
}

const BLOCK_DANGEROUS_ENTRIES: PermissionDenyEntry[] = [
  bash('rm-home', 'rm * ~*', 'rm targeting home directory'),
  bash('rm-home', 'rm * $HOME*', 'rm targeting $HOME'),
  bash('rm-home-var', 'rm * $HOME*', 'rm targeting $HOME'),
  bash('rm-home-trailing', 'rm * ~*', 'rm with trailing ~/ or $HOME'),
  bash('rm-root', 'rm -rf /', 'rm targeting root filesystem'),
  bash('rm-root', 'rm -rf /*', 'rm targeting root filesystem'),
  bash('rm-system', 'rm * /etc*', 'rm targeting system directory'),
  bash('rm-system', 'rm * /usr*', 'rm targeting system directory'),
  bash('rm-system', 'rm * /var*', 'rm targeting system directory'),
  bash('rm-system', 'rm * /bin*', 'rm targeting system directory'),
  bash('rm-system', 'rm -rf /etc*', 'rm targeting system directory'),
  bash('rm-cwd', 'rm -rf ./*', 'rm deleting current directory contents'),
  bash('rm-cwd', 'rm -rf *', 'rm deleting current directory contents'),
  bash('dd-disk', 'dd * of=/dev/*', 'dd writing to disk device'),
  bash('mkfs', 'mkfs *', 'mkfs formatting disk'),
  hookOnly('fork-bomb', 'block-dangerous-commands', 'fork bomb pattern hard to express in permissions'),
  bash('curl-pipe-sh', 'curl * | *', 'piping URL to shell'),
  bash('curl-pipe-sh', 'wget * | *', 'piping URL to shell'),
  bash('base64-pipe-sh', 'base64 * | *', 'base64 decode pipe to shell'),
  bash('eval-exec', 'eval *', 'eval dynamic execution'),
  hookOnly('sh-c-subshell', 'block-dangerous-commands', 'sh -c subshell requires contextual match'),
  hookOnly('download-exec', 'block-dangerous-commands', 'download-then-exec requires sequential context'),
  bash('reverse-shell-devtcp', '* /dev/tcp/*', '/dev/tcp reverse shell'),
  hookOnly('reverse-shell-netcat', 'block-dangerous-commands', 'nc reverse shell requires flag context'),
  bash('git-force-main', 'git push * --force*', 'force push to main/master'),
  bash('git-force-main', 'git push * -f *', 'force push to main/master'),
  bash('git-reset-hard', 'git reset --hard*', 'git reset --hard loses work'),
  bash('git-clean-f', 'git clean * -f*', 'git clean -f deletes untracked files'),
  bash('chmod-777', 'chmod * 777*', 'chmod 777 security risk'),
  hookOnly('chmod-setuid', 'block-dangerous-commands', 'setuid chmod modes need regex context'),
  bash('cat-env', 'cat * .env*', 'reading .env exposes secrets'),
  bash('cat-env', 'less * .env*', 'reading .env exposes secrets'),
  bash('cat-secrets', 'cat * *.pem*', 'reading secrets file'),
  bash('cat-secrets', 'cat * *.key*', 'reading secrets file'),
  bash('cat-secrets', 'cat * id_rsa*', 'reading secrets file'),
  bash('env-dump', 'printenv*', 'env dump may expose secrets'),
  bash('env-dump', 'env *', 'env dump may expose secrets'),
  bash('echo-secret', 'echo * $*SECRET*', 'echoing secret variable'),
  bash('echo-secret', 'echo * $*KEY*', 'echoing secret variable'),
  bash('echo-secret', 'echo * $*TOKEN*', 'echoing secret variable'),
  bash('docker-vol-rm', 'docker volume rm*', 'docker volume deletion'),
  bash('docker-vol-rm', 'docker volume prune*', 'docker volume deletion'),
  bash('podman-vol-rm', 'podman volume rm*', 'podman volume deletion'),
  bash('podman-vol-rm', 'podman volume prune*', 'podman volume deletion'),
  bash('rm-ssh', 'rm * .ssh*', 'deleting SSH keys'),
  bash('git-force-lease-main', 'git push * --force-with-lease*', 'force-with-lease to main/master'),
  bash('kubectl-get-secret', 'kubectl get secret*', 'kubectl get secret exposes credentials'),
  bash('kubectl-describe-secret', 'kubectl describe secret*', 'kubectl describe secret exposes credentials'),
  bash('docker-exec-env', 'docker exec * env*', 'docker exec printing environment'),
  bash('docker-exec-env', 'docker exec * printenv*', 'docker exec printing environment'),
  bash('podman-exec-env', 'podman exec * env*', 'podman exec printing environment'),
  bash('podman-exec-env', 'podman exec * printenv*', 'podman exec printing environment'),
  bash('pip-install', 'pip install *', 'use uv instead of pip'),
  bash('pip-install', 'pip3 install *', 'use uv instead of pip'),
  bash('npm-install', 'npm install *', 'use bun instead of npm'),
  bash('npm-ci', 'npm ci *', 'use bun install --frozen-lockfile'),
  bash('pnpm-install', 'pnpm install *', 'use bun instead of pnpm'),
  bash('yarn-install', 'yarn install *', 'use bun instead of yarn'),
  bash('npx', 'npx *', 'use bunx instead of npx'),
  bash('python-script', 'python * *.py*', 'use uv run instead of python script'),
  bash('python3-script', 'python3 * *.py*', 'use uv run instead of python3 script'),
  bash('python-module', 'python * -m *', 'use uv run instead of python -m'),
  bash('python3-module', 'python3 * -m *', 'use uv run instead of python3 -m'),
  bash('node-script', 'node * *.js*', 'use bun instead of node script'),
  bash('hook-bypass-path', 'git * -c core.hooksPath=*', 'hook path bypass'),
  bash('hook-bypass-config', 'git config * core.hooksPath*', 'persistent hook path bypass'),
  bash('no-verify', 'git commit * --no-verify*', 'commit hook bypass'),
  bash('no-verify-short', 'git commit * -n*', 'commit hook bypass via -n'),
  bash('push-no-verify', 'git push * --no-verify*', 'push hook bypass'),
  bash('merge-no-verify', 'git merge * --no-verify*', 'merge hook bypass'),
  hookOnly('git-pull-merge', 'block-dangerous-commands', 'git pull merge requires branch context'),
  bash('git-update-ref-delete', 'git update-ref -d refs/heads/*', 'update-ref branch delete bypass'),
  bash('git-force-any', 'git push * --force*', 'force push any branch'),
  bash('git-force-any', 'git push * -f *', 'force push any branch'),
  bash('git-checkout-dot', 'git checkout .*', 'git checkout . discards changes'),
  bash('sudo-rm', 'sudo rm *', 'sudo rm elevated privileges'),
  bash('docker-prune', 'docker system prune*', 'docker prune removes images'),
  bash('docker-prune', 'docker volume prune*', 'docker volume prune'),
  bash('podman-prune', 'podman system prune*', 'podman prune removes images'),
  bash('podman-prune', 'podman volume prune*', 'podman volume prune'),
  bash('crontab-r', 'crontab -r*', 'removes all cron jobs'),
  hookOnly('merge-ff-bypass', 'block-dangerous-commands', 'FF merge on protected branch needs cwd context'),
  hookOnly('merge-squash-bypass', 'block-dangerous-commands', 'squash merge on protected branch needs cwd context'),
  hookOnly('merge-conclude-bypass', 'block-dangerous-commands', 'merge --continue needs MERGE_HEAD context'),
  bash('protected-branch-delete', 'git branch -D main*', 'delete protected branch'),
  bash('protected-branch-delete', 'git branch -D master*', 'delete protected branch'),
  bash('protected-branch-delete', 'git push * --delete main*', 'delete remote protected branch'),
  bash('protected-branch-delete', 'git push * --delete master*', 'delete remote protected branch'),
  bash('protected-branch-delete', 'git push * -d main*', 'delete remote protected branch'),
  bash('protected-branch-delete', 'git push * -d master*', 'delete remote protected branch'),
];

const PROTECT_SECRETS_FILE_ENTRIES: PermissionDenyEntry[] = [
  ...sensitivePath('env-file', '//**/.env', '.env file contains secrets'),
  ...sensitivePath('env-file', '//**/.env.*', '.env variants contain secrets'),
  ...sensitivePath('envrc', '//**/.envrc', '.envrc contains secrets'),
  ...sensitivePath('ssh-private-key', '//**/.ssh/id_*', 'SSH private key'),
  ...sensitivePath('ssh-private-key-2', '//**/id_rsa', 'SSH private key'),
  ...sensitivePath('ssh-private-key-2', '//**/id_ed25519', 'SSH private key'),
  ...sensitivePath('ssh-private-key-2', '//**/id_ecdsa', 'SSH private key'),
  ...sensitivePath('ssh-private-key-2', '//**/id_dsa', 'SSH private key'),
  ...sensitivePath('ssh-authorized', '//**/.ssh/authorized_keys', 'SSH authorized_keys'),
  ...sensitivePath('aws-credentials', '//**/.aws/credentials', 'AWS credentials file'),
  ...sensitivePath('aws-config', '//**/.aws/config', 'AWS config may contain secrets'),
  ...sensitivePath('kube-config', '//**/.kube/config', 'Kubernetes config contains credentials'),
  ...sensitivePath('pem-key', '//**/*.pem', 'PEM key file'),
  ...sensitivePath('key-file', '//**/*.key', 'Key file'),
  ...sensitivePath('p12-key', '//**/*.p12', 'PKCS12 key file'),
  ...sensitivePath('p12-key', '//**/*.pfx', 'PKCS12 key file'),
  ...sensitivePath('pub-key', '//**/*.pub', 'Public key file'),
  ...sensitivePath('tfstate', '//**/*.tfstate', 'Terraform state contains secrets'),
  ...sensitivePath('tfstate', '//**/*.tfstate.*', 'Terraform state backup contains secrets'),
  ...sensitivePath('tfvars', '//**/*.tfvars', 'Terraform variables may contain secrets'),
  ...sensitivePath('ssh-config', '//**/.ssh/config', 'SSH config file'),
  ...sensitivePath('credentials-json', '//**/credentials.json', 'Credentials file'),
  ...sensitivePath('secrets-file', '//**/secrets.json', 'Secrets configuration file'),
  ...sensitivePath('secrets-file', '//**/secrets.yaml', 'Secrets configuration file'),
  ...sensitivePath('secrets-file', '//**/secrets.yml', 'Secrets configuration file'),
  ...sensitivePath('secrets-file', '//**/credentials.yaml', 'Credentials configuration file'),
  ...sensitivePath('secrets-file', '//**/credentials.yml', 'Credentials configuration file'),
  ...sensitivePath('service-account', '//**/service_account*.json', 'GCP service account key'),
  ...sensitivePath('service-account', '//**/service-account*.json', 'GCP service account key'),
  ...sensitivePath('gcloud-creds', '//**/.config/gcloud/*credentials*', 'GCloud credentials'),
  ...sensitivePath('gcloud-creds', '//**/.config/gcloud/*tokens*', 'GCloud tokens'),
  ...sensitivePath('azure-creds', '//**/.azure/credentials', 'Azure credentials'),
  ...sensitivePath('azure-creds', '//**/.azure/accessTokens', 'Azure access tokens'),
  ...sensitivePath('docker-config', '//**/.docker/config.json', 'Docker config may contain registry auth'),
  ...sensitivePath('netrc', '//**/.netrc', '.netrc contains credentials'),
  ...sensitivePath('npmrc', '//**/.npmrc', '.npmrc may contain auth tokens'),
  ...sensitivePath('pypirc', '//**/.pypirc', '.pypirc contains PyPI credentials'),
  ...sensitivePath('gem-creds', '//**/.gem/credentials', 'RubyGems credentials'),
  ...sensitivePath('vault-token', '//**/.vault-token', 'Vault token file'),
  ...sensitivePath('vault-token', '//**/vault-token', 'Vault token file'),
  ...sensitivePath('keystore', '//**/*.keystore', 'Java keystore'),
  ...sensitivePath('keystore', '//**/*.jks', 'Java keystore'),
  ...sensitivePath('htpasswd', '//**/.htpasswd', 'htpasswd contains hashed passwords'),
  ...sensitivePath('htpasswd', '//**/htpasswd', 'htpasswd contains hashed passwords'),
  ...sensitivePath('pgpass', '//**/.pgpass', 'PostgreSQL password file'),
  ...sensitivePath('my-cnf', '//**/.my.cnf', 'MySQL config may contain password'),
  ...sensitivePath('database-config', '//**/database.json', 'Database config may contain passwords'),
  ...sensitivePath('database-config', '//**/database.yaml', 'Database config may contain passwords'),
  ...sensitivePath('database-config', '//**/database.yml', 'Database config may contain passwords'),
  ...sensitivePath('database-config', '//**/config/database.json', 'Database config may contain passwords'),
  ...sensitivePath('database-config', '//**/config/database.yaml', 'Database config may contain passwords'),
  ...sensitivePath('ssh-known-hosts', '//**/.ssh/known_hosts', 'SSH known_hosts reveals infrastructure'),
  ...sensitivePath('gitconfig', '//**/.gitconfig', '.gitconfig may contain credentials'),
  ...sensitivePath('curlrc', '//**/.curlrc', '.curlrc may contain auth'),
  ...sensitivePath('docker-compose-override', '//**/docker-compose.override.yml', 'docker-compose override secrets'),
  ...sensitivePath('docker-compose-override', '//**/docker-compose.override.yaml', 'docker-compose override secrets'),
];

const HOOK_ONLY_GATE_ENTRIES: PermissionDenyEntry[] = [
  hookOnly('branch-gate-main-write', 'branch-gate', 'non-feature branch write gate'),
  hookOnly('worktree-gate', 'workflow-gate', 'main checkout write restriction'),
  hookOnly('workflow-gate', 'workflow-gate', 'todo-before-read orchestration gate'),
  hookOnly('orchestrator-gate', 'workflow-gate', 'orchestrator direct read/write gate'),
  hookOnly('git-ship-gate', 'workflow-gate', 'orchestrator git ship restriction'),
  hookOnly('protect-secrets-content', 'protect-secrets', 'Write/Edit embedded secret content scan'),
  hookOnly('unmerged-branch-delete', 'branch-delete-gate', 'unmerged branch delete needs git context'),
  hookOnly('worktree-prune', 'branch-delete-gate', 'worktree prune needs orchestration context'),
];

/** Ensure every BLOCK_DANGEROUS_RULE_IDS id appears at least once (compile-time guard). */
const _blockDangerousCoverage: Record<(typeof BLOCK_DANGEROUS_RULE_IDS)[number], true> = Object.fromEntries(
  BLOCK_DANGEROUS_RULE_IDS.map((id) => [id, true]),
) as Record<(typeof BLOCK_DANGEROUS_RULE_IDS)[number], true>;
void _blockDangerousCoverage;

export const PERMISSION_DENY_REGISTRY: PermissionDenyEntry[] = [
  ...BLOCK_DANGEROUS_ENTRIES,
  ...PROTECT_SECRETS_FILE_ENTRIES,
  ...HOOK_ONLY_GATE_ENTRIES,
];

export function getDenyRules(): string[] {
  const rules = PERMISSION_DENY_REGISTRY.filter((entry) => !entry.hookOnly && entry.rule).map(
    (entry) => entry.rule as string,
  );
  return [...new Set(rules)].sort();
}
