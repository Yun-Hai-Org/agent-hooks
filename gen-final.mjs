import { readFileSync, writeFileSync } from 'fs';

// Read the original file
const orig = readFileSync('.claude/hooks/__tests__/protect-secrets.test.js', 'utf8');
const lines = orig.split('\n');

// Build new file line by line to avoid string replacement artifacts
const result = [];
let i = 0;
let inExportBlock = false;

while (i < lines.length) {
  const line = lines[i];

  // 1. Update count assertions
  if (line.includes('expect(SENSITIVE_FILES.length).toBeGreaterThanOrEqual(20)')) {
    result.push('    it(\'SENSITIVE_FILES 应该至少有 30 条规则 (新增 Terraform + SSH 模式后)\', () => {');
    result.push('      expect(SENSITIVE_FILES.length).toBeGreaterThanOrEqual(30);');
    result.push('    });');
    i++;
    continue;
  }

  if (line.includes('expect(BASH_PATTERNS.length).toBeGreaterThanOrEqual(20)')) {
    result.push('    it(\'BASH_PATTERNS 应该至少有 22 条规则\', () => {');
    result.push('      expect(BASH_PATTERNS.length).toBeGreaterThanOrEqual(22);');
    result.push('    });');
    i++;
    continue;
  }

  // 2. After CONTENT_PATTERNS test, add pattern existence tests
  if (line.includes("it('CONTENT_PATTERNS 应该至少有 15 条规则'")) {
    result.push(line);
    i++;
    // Skip the expect and closing lines
    while (i < lines.length && !lines[i].trim().startsWith('});')) {
      result.push(lines[i]);
      i++;
    }
    result.push(lines[i]); // the });
    i++;

    // Now add the new pattern validation tests
    result.push('');
    result.push("    it('SENSITIVE_FILES 中应该有 Terraform 状态文件模式', () => {");
    result.push("      const p = SENSITIVE_FILES.find(f => f.id === 'tfstate');");
    result.push('      expect(p).toBeDefined();');
    result.push("      expect(p.regex.test('terraform.tfstate')).toBe(true);");
    result.push("      expect(p.regex.test('terraform.tfstate.backup')).toBe(true);");
    result.push('    });');
    result.push('');
    result.push("    it('SENSITIVE_FILES 中应该有 Terraform 变量文件模式', () => {");
    result.push("      const p = SENSITIVE_FILES.find(f => f.id === 'tfvars');");
    result.push('      expect(p).toBeDefined();');
    result.push("      expect(p.regex.test('terraform.tfvars')).toBe(true);");
    result.push("      expect(p.regex.test('prod.tfvars')).toBe(true);");
    result.push('    });');
    result.push('');
    result.push("    it('SENSITIVE_FILES 中应该有 SSH 配置模式', () => {");
    result.push("      const p = SENSITIVE_FILES.find(f => f.id === 'ssh-config');");
    result.push('      expect(p).toBeDefined();');
    result.push("      expect(p.regex.test('.ssh/config')).toBe(true);");
    result.push('    });');
    result.push('');
    result.push("    it('SENSITIVE_FILES 中应该有公钥文件模式', () => {");
    result.push("      const p = SENSITIVE_FILES.find(f => f.id === 'pub-key');");
    result.push('      expect(p).toBeDefined();');
    result.push("      expect(p.regex.test('id_rsa.pub')).toBe(true);");
    result.push('    });');
    result.push('');
    result.push("    it('BASH_PATTERNS 中应该有 Terraform 文件模式', () => {");
    result.push("      const p = BASH_PATTERNS.find(f => f.id === 'cat-tfstate');");
    result.push('      expect(p).toBeDefined();');
    result.push("      expect(p.regex.test('cat terraform.tfstate')).toBe(true);");
    result.push('    });');
    continue;
  }

  // 3. After .kube/config test, add Terraform+SSH file path tests
  if (line.includes(".kube/config 应该被阻止 (critical)")) {
    result.push(line);
    i++;
    while (i < lines.length && !lines[i].includes("expect(result.blocked).toBe(true)")) {
      result.push(lines[i]);
      i++;
    }
    result.push(lines[i]);
    i++;
    // The .kube/config test block ends with });
    while (i < lines.length && lines[i].trim() !== '});') {
      result.push(lines[i]);
      i++;
    }
    result.push('    });');
    i++;

    // Now check if there are already Terraform tests here (from prev run)
    // Skip past any already added tests
    // Add new tests
    result.push('');
    result.push('    // === NEW: Terraform (CRITICAL) ===');
    result.push("    it('terraform.tfstate 应该被阻止 (critical)', () => {");
    result.push("      const result = checkFilePath('terraform.tfstate');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push("      expect(result.pattern.level).toBe('critical');");
    result.push('    });');
    result.push('');
    result.push("    it('prod/terraform.tfstate 应该被阻止', () => {");
    result.push("      const result = checkFilePath('prod/terraform.tfstate');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('terraform.tfstate.backup 应该被阻止', () => {");
    result.push("      const result = checkFilePath('terraform.tfstate.backup');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('terraform.tfvars 应该被阻止 (critical)', () => {");
    result.push("      const result = checkFilePath('terraform.tfvars');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push("      expect(result.pattern.level).toBe('critical');");
    result.push('    });');
    result.push('');
    result.push("    it('prod/terraform.tfvars 应该被阻止', () => {");
    result.push("      const result = checkFilePath('prod/terraform.tfvars');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('prod.tfvars 应该被阻止', () => {");
    result.push("      const result = checkFilePath('prod.tfvars');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push('    // === NEW: SSH 配置 (CRITICAL) ===');
    result.push("    it('.ssh/config 应该被阻止 (critical)', () => {");
    result.push("      const result = checkFilePath('.ssh/config');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push("      expect(result.pattern.level).toBe('critical');");
    result.push('    });');
    result.push('');
    result.push("    it('home/user/.ssh/config 应该被阻止', () => {");
    result.push("      const result = checkFilePath('home/user/.ssh/config');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('id_rsa.pub 应该被阻止 (critical)', () => {");
    result.push("      const result = checkFilePath('id_rsa.pub');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push("      expect(result.pattern.level).toBe('critical');");
    result.push('    });');
    result.push('');
    result.push("    it('server.pub 应该被阻止 (critical)', () => {");
    result.push("      const result = checkFilePath('server.pub');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push('    });');
    continue;
  }

  // 4. After .env.example allowlisted test, add normal .tf files should not be blocked
  if (line.includes(".env.example 不应该被阻止 (白名单)")) {
    result.push(line);
    i++;
    // Skip the body and closing of the .env.example test
    while (i < lines.length && lines[i].trim() !== '});') {
      result.push(lines[i]);
      i++;
    }
    result.push('    });');
    i++;

    // Check if we're at the "安全级别测试" section next
    // Add normal .tf tests before that
    result.push('');
    result.push('    // === NEW: 正常 Terraform 代码文件 ===');
    result.push("    it('main.tf 不应该被阻止', () => {");
    result.push("      const result = checkFilePath('main.tf');");
    result.push('      expect(result.blocked).toBe(false);');
    result.push('    });');
    result.push('');
    result.push("    it('variables.tf 不应该被阻止', () => {");
    result.push("      const result = checkFilePath('variables.tf');");
    result.push('      expect(result.blocked).toBe(false);');
    result.push('    });');
    continue;
  }

  // 5. After cat .aws/credentials test, add Terraform Bash command tests
  if (line.includes("cat .aws/credentials 应该被阻止")) {
    result.push(line);
    i++;
    while (i < lines.length && lines[i].trim() !== '});') {
      result.push(lines[i]);
      i++;
    }
    result.push('    });');
    i++;

    result.push('');
    result.push('    // === NEW: Terraform Bash 命令 ===');
    result.push("    it('cat terraform.tfstate 应该被阻止', () => {");
    result.push("      const result = checkBashCommand('cat terraform.tfstate');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('cp terraform.tfvars /tmp 应该被阻止', () => {");
    result.push("      const result = checkBashCommand('cp terraform.tfvars /tmp');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('cat variables.tfvars 应该被阻止', () => {");
    result.push("      const result = checkBashCommand('cat variables.tfvars');");
    result.push('      expect(result.blocked).toBe(true);');
    result.push('    });');
    continue;
  }

  // 6. After git status, add normal terraform commands tests
  if (line.includes("git status 应该被允许")) {
    result.push(line);
    i++;
    while (i < lines.length && lines[i].trim() !== '});') {
      result.push(lines[i]);
      i++;
    }
    result.push('    });');
    i++;

    result.push('');
    result.push('    // === NEW: 正常 Terraform 命令 ===');
    result.push("    it('terraform apply 应该被允许', () => {");
    result.push("      const result = checkBashCommand('terraform apply');");
    result.push('      expect(result.blocked).toBe(false);');
    result.push('    });');
    result.push('');
    result.push("    it('terraform plan 应该被允许', () => {");
    result.push("      const result = checkBashCommand('terraform plan');");
    result.push('      expect(result.blocked).toBe(false);');
    result.push('    });');
    continue;
  }

  // 7. After Write .env.example (白名单) test in check() section, add Terraform check() tests
  if (line.includes("Write .env.example 应该被允许 (白名单)")) {
    result.push(line);
    i++;
    while (i < lines.length && lines[i].trim() !== '});') {
      result.push(lines[i]);
      i++;
    }
    result.push('    });');
    i++;

    result.push('');
    result.push('    // === NEW: Terraform 集成测试 ===');
    result.push("    it('Write terraform.tfstate 应该被阻止', () => {");
    result.push("      const r = check('Write', { file_path: 'terraform.tfstate', content: '{\"version\": 1}' });");
    result.push('      expect(r.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('Write terraform.tfvars 应该被阻止', () => {");
    result.push("      const r = check('Write', { file_path: 'terraform.tfvars', content: 'sensitive = \"value\"' });");
    result.push('      expect(r.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('Edit terraform.tfstate 应该被阻止', () => {");
    result.push("      const r = check('Edit', { file_path: 'terraform.tfstate', new_string: '{\"version\": 2}' });");
    result.push('      expect(r.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('Read terraform.tfstate 应该被阻止', () => {");
    result.push("      const r = check('Read', { file_path: 'terraform.tfstate' });");
    result.push('      expect(r.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('Read terraform.tfvars 应该被阻止', () => {");
    result.push("      const r = check('Read', { file_path: 'terraform.tfvars' });");
    result.push('      expect(r.blocked).toBe(true);');
    result.push('    });');
    result.push('');
    result.push("    it('Read main.tf 应该被允许', () => {");
    result.push("      const r = check('Read', { file_path: 'main.tf' });");
    result.push('      expect(r.blocked).toBe(false);');
    result.push('    });');
    continue;
  }

  // 8. For lines we've already handled above, skip
  // But capture all other lines normally
  result.push(line);
  i++;
}

const text = result.join('\n');
writeFileSync('.claude/hooks/__tests__/protect-secrets.test.js', text, 'utf8');
console.log('Generated complete test file');
console.log('Lines:', text.split('\n').length);