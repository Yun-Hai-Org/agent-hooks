import { writeFileSync, readFileSync } from 'fs';

const orig = readFileSync('.claude/hooks/__tests__/protect-secrets.test.js', 'utf8');

// First fix the corrupted area - remove everything between the bad injection point
// Find start marker and reconstruct

// Read original file content fresh from git
import { execSync } from 'child_process';
const originalContent = execSync('git show HEAD:.claude/hooks/__tests__/protect-secrets.test.js', { encoding: 'utf8' });

// Build complete new test content by inserting new tests into original
// Strategy: replace specific anchor lines in the original

let result = originalContent;

// 1. Update SENSITIVE_FILES count test
result = result.replace(
  "expect(SENSITIVE_FILES.length).toBeGreaterThanOrEqual(20);",
  "expect(SENSITIVE_FILES.length).toBeGreaterThanOrEqual(30);"
);

// 2. Update BASH_PATTERNS count test
result = result.replace(
  "expect(BASH_PATTERNS.length).toBeGreaterThanOrEqual(20);",
  "expect(BASH_PATTERNS.length).toBeGreaterThanOrEqual(22);"
);

// 3. Add export pattern validation tests
result = result.replace(
  "it('CONTENT_PATTERNS 应该至少有 15 条规则', () => {",
  `it('CONTENT_PATTERNS 应该至少有 15 条规则', () => {
      expect(CONTENT_PATTERNS.length).toBeGreaterThanOrEqual(15);
    });

    it('SENSITIVE_FILES 中应该有 Terraform 状态文件模式 (tfstate)', () => {
      const p = SENSITIVE_FILES.find(f => f.id === 'tfstate');
      expect(p).toBeDefined();
      expect(p.regex.test('terraform.tfstate')).toBe(true);
      expect(p.regex.test('terraform.tfstate.backup')).toBe(true);
    });

    it('SENSITIVE_FILES 中应该有 Terraform 变量文件模式 (tfvars)', () => {
      const p = SENSITIVE_FILES.find(f => f.id === 'tfvars');
      expect(p).toBeDefined();
      expect(p.regex.test('terraform.tfvars')).toBe(true);
      expect(p.regex.test('prod.tfvars')).toBe(true);
    });

    it('SENSITIVE_FILES 中应该有 SSH 配置模式 (ssh-config)', () => {
      const p = SENSITIVE_FILES.find(f => f.id === 'ssh-config');
      expect(p).toBeDefined();
      expect(p.regex.test('.ssh/config')).toBe(true);
    });

    it('SENSITIVE_FILES 中应该有公钥文件模式 (pub-key)', () => {
      const p = SENSITIVE_FILES.find(f => f.id === 'pub-key');
      expect(p).toBeDefined();
      expect(p.regex.test('id_rsa.pub')).toBe(true);
    });

    it('BASH_PATTERNS 中应该有 Terraform 状态文件读取模式 (cat-tfstate)', () => {
      const p = BASH_PATTERNS.find(f => f.id === 'cat-tfstate');
      expect(p).toBeDefined();
      expect(p.regex.test('cat terraform.tfstate')).toBe(true);
    });

    it('BASH_PATTERNS 中应该有 Terraform 变量文件复制模式 (cp-tfvars)', () => {
      const p = BASH_PATTERNS.find(f => f.id === 'cp-tfvars');
      expect(p).toBeDefined();
      expect(p.regex.test('cp terraform.tfvars /tmp')).toBe(true);
    });`
);

// 4. Add Terraform checkFilePath tests
result = result.replace(
  "it('sever.pfx 应该被阻止 (critical)', () => {",
  `it('sever.pfx 应该被阻止 (critical)', () => {
      const result = checkFilePath('sever.pfx');
      expect(result.blocked).toBe(true);
    });

    // === NEW: Terraform 状态文件 (CRITICAL) ===
    it('terraform.tfstate 应该被阻止 (critical)', () => {
      const result = checkFilePath('terraform.tfstate');
      expect(result.blocked).toBe(true);
      expect(result.pattern.level).toBe('critical');
    });

    it('prod/terraform.tfstate 应该被阻止', () => {
      const result = checkFilePath('prod/terraform.tfstate');
      expect(result.blocked).toBe(true);
    });

    it('terraform.tfstate.backup 应该被阻止', () => {
      const result = checkFilePath('terraform.tfstate.backup');
      expect(result.blocked).toBe(true);
    });

    it('terraform.tfvars 应该被阻止 (critical)', () => {
      const result = checkFilePath('terraform.tfvars');
      expect(result.blocked).toBe(true);
      expect(result.pattern.level).toBe('critical');
    });

    it('prod/terraform.tfvars 应该被阻止', () => {
      const result = checkFilePath('prod/terraform.tfvars');
      expect(result.blocked).toBe(true);
    });

    it('prod.tfvars 应该被阻止', () => {
      const result = checkFilePath('prod.tfvars');
      expect(result.blocked).toBe(true);
    });

    // === NEW: SSH 配置 (CRITICAL) ===
    it('.ssh/config 应该被阻止 (critical)', () => {
      const result = checkFilePath('.ssh/config');
      expect(result.blocked).toBe(true);
      expect(result.pattern.level).toBe('critical');
    });

    it('home/user/.ssh/config 应该被阻止', () => {
      const result = checkFilePath('home/user/.ssh/config');
      expect(result.blocked).toBe(true);
    });

    it('.ssh/id_rsa.pub 应该被阻止 (critical)', () => {
      const result = checkFilePath('.ssh/id_rsa.pub');
      expect(result.blocked).toBe(true);
      expect(result.pattern.level).toBe('critical');
    });

    it('server.pub 应该被阻止 (critical)', () => {
      const result = checkFilePath('server.pub');
      expect(result.blocked).toBe(true);
    });`
);

// Fix the typo I introduced (sever.pfx -> cert.pfx) - the original has cert.pfx
result = result.replace("it('sever.pfx", "it('cert.pfx");

// 5. Add normal tf file checks in "should not be blocked" section
result = result.replace(
  "it('.env.example 不应该被阻止 (白名单)', () => {",
  `it('.env.example 不应该被阻止 (白名单)', () => {
      const result = checkFilePath('.env.example');
      expect(result.blocked).toBe(false);
    });

    // === NEW: 正常 Terraform 代码文件不应被阻止 ===
    it('main.tf 不应该被阻止 (Terraform 代码文件)', () => {
      const result = checkFilePath('main.tf');
      expect(result.blocked).toBe(false);
    });

    it('variables.tf 不应该被阻止 (Terraform 代码文件)', () => {
      const result = checkFilePath('variables.tf');
      expect(result.blocked).toBe(false);
    });`
);

// 6. Add Terraform Bash command tests
result = result.replace(
  "it('cat .ssh/id_rsa 应该被阻止', () => {",
  `it('cat .ssh/id_rsa 应该被阻止', () => {
      const result = checkBashCommand('cat .ssh/id_rsa');
      expect(result.blocked).toBe(true);
    });

    // === NEW: Terraform Bash 命令 ===
    it('cat terraform.tfstate 应该被阻止', () => {
      const result = checkBashCommand('cat terraform.tfstate');
      expect(result.blocked).toBe(true);
    });

    it('cp terraform.tfvars /tmp 应该被阻止', () => {
      const result = checkBashCommand('cp terraform.tfvars /tmp');
      expect(result.blocked).toBe(true);
    });

    it('cat variables.tfvars 应该被阻止', () => {
      const result = checkBashCommand('cat variables.tfvars');
      expect(result.blocked).toBe(true);
    });`
);

// 7. Add terraform commands should be allowed
result = result.replace(
  "it('git status 应该被允许', () => {",
  `it('git status 应该被允许', () => {
      const result = checkBashCommand('git status');
      expect(result.blocked).toBe(false);
    });

    // === NEW: 正常 Terraform 命令应该被允许 ===
    it('terraform apply 应该被允许', () => {
      const result = checkBashCommand('terraform apply');
      expect(result.blocked).toBe(false);
    });

    it('terraform plan 应该被允许', () => {
      const result = checkBashCommand('terraform plan');
      expect(result.blocked).toBe(false);
    });`
);

// 8. Add Terraform check() integration tests
result = result.replace(
  "it('Write .env.example 应该被允许 (白名单)', () => {",
  `it('Write .env.example 应该被允许 (白名单)', () => {
      const result = check('Write', { file_path: '.env.example', content: 'SECRET=example' });
      expect(result.blocked).toBe(false);
    });

    // === NEW: Write/Edit/Read Terraform 文件 ===
    it('Write terraform.tfstate 应该被阻止', () => {
      const result = check('Write', { file_path: 'terraform.tfstate', content: '{"version": 1}' });
      expect(result.blocked).toBe(true);
    });

    it('Write terraform.tfvars 应该被阻止', () => {
      const result = check('Write', { file_path: 'terraform.tfvars', content: 'sensitive = "value"' });
      expect(result.blocked).toBe(true);
    });

    it('Edit terraform.tfstate 应该被阻止', () => {
      const result = check('Edit', { file_path: 'terraform.tfstate', new_string: '{"version": 2}' });
      expect(result.blocked).toBe(true);
    });

    it('Read terraform.tfstate 应该被阻止', () => {
      const result = check('Read', { file_path: 'terraform.tfstate' });
      expect(result.blocked).toBe(true);
    });

    it('Read terraform.tfvars 应该被阻止', () => {
      const result = check('Read', { file_path: 'terraform.tfvars' });
      expect(result.blocked).toBe(true);
    });

    it('Read main.tf 应该被允许 (正常 Terraform 代码文件)', () => {
      const result = check('Read', { file_path: 'main.tf' });
      expect(result.blocked).toBe(false);
    });`
);

writeFileSync('.claude/hooks/__tests__/protect-secrets.test.js', result, 'utf8');
console.log('DONE - file written, size:', result.length);
console.log('Lines:', result.split('\\n').length);