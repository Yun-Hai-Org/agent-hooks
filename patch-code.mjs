import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('.claude/hooks/protect-secrets.js', 'utf8');

// ============ Add new SENSITIVE_FILES entries ============
// After "p12-key" entry
const afterP12 = `  { level: 'critical', id: 'pub-key', regex: /\\.pub$/i, reason: 'Public key file may expose infrastructure details' },
  { level: 'critical', id: 'tfstate', regex: /\\.tfstate(?:\\.[^/]*)?$/i, reason: 'Terraform state file contains infrastructure secrets' },
  { level: 'critical', id: 'tfvars', regex: /\\.tfvars$/i, reason: 'Terraform variables file may contain secrets' },
  { level: 'critical', id: 'ssh-config', regex: /(?:^|\\/)\\.ssh\\/config$/, reason: 'SSH config file' },
`;

content = content.replace(
  `{ level: 'critical', id: 'p12-key', regex: /\\.(p12|pfx)$/i, reason: 'PKCS12 key file' },`,
  `{ level: 'critical', id: 'p12-key', regex: /\\.(p12|pfx)$/i, reason: 'PKCS12 key file' },
  { level: 'critical', id: 'pub-key', regex: /\\.pub$/i, reason: 'Public key file may expose infrastructure details' },
  { level: 'critical', id: 'tfstate', regex: /\\.tfstate(?:\\.[^/]*)?$/i, reason: 'Terraform state file contains infrastructure secrets' },
  { level: 'critical', id: 'tfvars', regex: /\\.tfvars$/i, reason: 'Terraform variables file may contain secrets' },
  { level: 'critical', id: 'ssh-config', regex: /(?:^|\\/)\\.ssh\\/config$/, reason: 'SSH config file' },`
);

// ============ Add new BASH_PATTERNS entries ============
// After cat-aws-creds entry
const afterCatAws = `  {
    level: 'critical',
    id: 'cat-tfstate',
    regex: /\\b(cat|less|head|tail|more|bat|view)\\s+[^|;]*\\.tfstate\\b/i,
    reason: 'Reading Terraform state file exposes secrets',
  },
  {
    level: 'high',
    id: 'cp-tfvars',
    regex: /\\b(cp|mv)\\b[^|;]*\\.tfvars\\b/i,
    reason: 'Copying Terraform variables file',
  },
  {
    level: 'high',
    id: 'cat-tfvars',
    regex: /\\b(cat|less|head|tail|more|bat|view)\\s+[^|;]*\\.tfvars\\b/i,
    reason: 'Reading Terraform variables file',
  },
`;

content = content.replace(
  `{ level: 'critical', id: 'cat-aws-creds', regex: /\\b(cat|less|head|tail|more)\\s+[^|;]*\\.aws\\/credentials/i, reason: 'Reading AWS credentials' },`,
  afterCatAws + `  { level: 'critical', id: 'cat-aws-creds', regex: /\\b(cat|less|head|tail|more)\\s+[^|;]*\\.aws\\/credentials/i, reason: 'Reading AWS credentials' },`
);

writeFileSync('.claude/hooks/protect-secrets.js', content, 'utf8');
console.log('protect-secrets.js patched successfully');
console.log('File size:', content.length);