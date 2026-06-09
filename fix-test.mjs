import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('.claude/hooks/__tests__/protect-secrets.test.js', 'utf8');

// Remove the duplicated code block
const fixed = content.replace(
  `    it('variables.tf 不应该被阻止 (Terraform 代码文件)', () => {
      const result = checkFilePath('variables.tf');
      expect(result.blocked).toBe(false);
    });
      const result = checkFilePath('.env.example');
      expect(result.blocked).toBe(false);
    });`,
  `    it('variables.tf 不应该被阻止 (Terraform 代码文件)', () => {
      const result = checkFilePath('variables.tf');
      expect(result.blocked).toBe(false);
    });`
);

// Check if there's also a duplicated .env.example test + main.tf from the "sever.pfx" replacement
// Let me also check for the "sever.pfx" -> should be "cert.pfx"
const fixed2 = fixed.replace(
  "it('sever.pfx",
  "it('cert.pfx"
);

writeFileSync('.claude/hooks/__tests__/protect-secrets.test.js', fixed2, 'utf8');
console.log('Fixed file, size:', fixed2.length);

// Check if syntax is valid
try {
  new Function(fixed2);
  console.log('Syntax looks valid');
} catch (e) {
  console.log('Syntax error:', e.message);
}

// Check for common corruption patterns
const lines = fixed2.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const result') && !lines[i].includes('it(') && !lines[i].includes('expect')) {
    // Check if previous line doesn't have proper it() wrapper
    if (i > 0 && !lines[i-1].includes('it(') && !lines[i-1].includes('});') && !lines[i-1].includes('{')) {
      console.log('Possible corruption at line', i+1, ':', lines[i]);
    }
  }
  // Check for orphaned closing braces
  if (lines[i].trim() === '}' && i > 0 && !lines[i-1].includes(';')) {
    console.log('Warning: orphaned brace at line', i+1);
  }
}