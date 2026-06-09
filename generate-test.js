import { writeFileSync, readFileSync } from 'fs';

// Read the updated test file
const content = readFileSync('.claude/hooks/__tests__/protect-secrets.test.js', 'utf8');

// Add Terraform Bash command tests - inject after "cat .aws/credentials should be blocked"
const step1 = content.replace(
  "it('cat .aws/credentials 应该被阻止', () => {",
  `it('cat .aws/credentials 应该被阻止', () => {
      const result = checkBashCommand('cat .aws/credentials');
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

// Add Terraform check() integration tests - inject after "Write .env.example"
const step2 = step1.replace(
  "it('Write .env.example 应该被允许', () => {",
  `it('Write .env.example 应该被允许', () => {
      const result = check('Write', { file_path: '.env.example', content: 'SECRET=example' });
      expect(result.blocked).toBe(false);
    });

    // === NEW: Terraform + SSH check() 集成测试 ===
    it('Write terraform.tfstate 应该被阻止', () => {
      const result = check('Write', { file_path: 'terraform.tfstate', content: '{"version": 1}' });
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
    });

    it('Write terraform.tfvars 应该被阻止', () => {
      const result = check('Write', { file_path: 'terraform.tfvars', content: 'sensitive = "value"' });
      expect(result.blocked).toBe(true);
    });`
);

// Add export validation tests for new patterns - add before "isAllowlisted" describe
const step3 = step2.replace(
  "describe('isAllowlisted', () => {",
  `describe('isAllowlisted', () => {`
);

// Actually, let me find the export validation section to add new pattern checks
const step3b = step3.replace(
  "it('CONTENT_PATTERNS 应该至少有 15 条规则', () => {",
  `it('CONTENT_PATTERNS 应该至少有 15 条规则', () => {
      expect(CONTENT_PATTERNS.length).toBeGreaterThanOrEqual(15);
    });

    it('SENSITIVE_FILES 中应该有 Terraform 状态文件模式', () => {
      const tfStatePattern = SENSITIVE_FILES.find(f => f.id === 'tfstate');
      expect(tfStatePattern).toBeDefined();
      expect(tfStatePattern.regex.test('terraform.tfstate')).toBe(true);
    });

    it('SENSITIVE_FILES 中应该有 Terraform 变量文件模式', () => {
      const tfVarsPattern = SENSITIVE_FILES.find(f => f.id === 'tfvars');
      expect(tfVarsPattern).toBeDefined();
      expect(tfVarsPattern.regex.test('terraform.tfvars')).toBe(true);
    });

    it('SENSITIVE_FILES 中应该有 SSH 配置模式', () => {
      const sshConfigPattern = SENSITIVE_FILES.find(f => f.id === 'ssh-config');
      expect(sshConfigPattern).toBeDefined();
      expect(sshConfigPattern.regex.test('.ssh/config')).toBe(true);
    });

    it('SENSITIVE_FILES 中应该有公钥文件模式', () => {
      const pubKeyPattern = SENSITIVE_FILES.find(f => f.id === 'pub-key');
      expect(pubKeyPattern).toBeDefined();
      expect(pubKeyPattern.regex.test('id_rsa.pub')).toBe(true);
    });

    it('BASH_PATTERNS 中应该有 Terraform 状态文件读取模式', () => {
      const tfCatPattern = BASH_PATTERNS.find(f => f.id === 'cat-tfstate');
      expect(tfCatPattern).toBeDefined();
      expect(tfCatPattern.regex.test('cat terraform.tfstate')).toBe(true);
    });`
);

// Also add normal terraform commands should be allowed
const step4 = step3b.replace(
  "it('git status 应该被允许', () => {",
  `it('git status 应该被允许', () => {
      const result = checkBashCommand('git status');
      expect(result.blocked).toBe(false);
    });

    it('terraform apply 应该被允许', () => {
      const result = checkBashCommand('terraform apply');
      expect(result.blocked).toBe(false);
    });

    it('terraform plan 应该被允许', () => {
      const result = checkBashCommand('terraform plan');
      expect(result.blocked).toBe(false);
    });`
);

// Add normal Terraform code files in checkFilePath
const step5 = step4.replace(
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
    });

    // 安全级别测试`
);

writeFileSync('.claude/hooks/__tests__/protect-secrets.test.js', step5, 'utf8');
console.log('Test file fully updated with all new test cases');
console.log('File size:', step5.length, 'bytes');