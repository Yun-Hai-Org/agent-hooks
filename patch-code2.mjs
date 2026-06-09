import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('.claude/hooks/protect-secrets.js', 'utf8');

// Add Terraform BASH_PATTERNS before the closing ] of BASH_PATTERNS
const tfBashEntries = `
  // Terraform
  {
    level: 'high',
    id: 'cat-tfstate',
    regex: /\\b(cat|less|head|tail|more|bat|view)\\s+[^|;]*\\.tfstate\\b/i,
    reason: 'Reading Terraform state file exposes infrastructure data',
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

// Find the end of BASH_PATTERNS array - right before ";"
content = content.replace(
  "];\n\n// Content patterns for scanning file content (Write/Edit)",
  tfBashEntries + "];\n\n// Content patterns for scanning file content (Write/Edit)"
);

writeFileSync('.claude/hooks/protect-secrets.js', content, 'utf8');
console.log('BASH_PATTERNS Terraform entries added');
console.log('File size:', content.length);