import { readFileSync, writeFileSync } from 'fs';

// Read existing file
const base = readFileSync('.claude/hooks/__tests__/protect-secrets.test.js', 'utf8');

// We need to carefully inject specific blocks at specific locations
// Strategy: use a series of accurate replacements that won't create duplicates

let content = base;

// =========== 1. Update count assertions ===========
content = content.replace(
  'expect(SENSITIVE_FILES.length).toBeGreaterThanOrEqual(20);',
  'expect(SENSITIVE_FILES.length).toBeGreaterThanOrEqual(30);'
);
content = content.replace(
  'expect(BASH_PATTERNS.length).toBeGreaterThanOrEqual(20);',
  'expect(BASH_PATTERNS.length).toBeGreaterThanOrEqual(22);'
);

// =========== 2. Add export validation for new patterns ===========
// Find the CONTENT_PATTERNS test and add after it
const insertAfterContentPatterns = `
    it('SENSITIVE_FILES 中应该有 Terraform 状态文件模式', () => {
      const p = SENSITIVE_FILES.find(f => f.id === 'tfstate');
      expect(p).toBeDefined();
      expect(p.regex.test('terraform.tfstate')).toBe(true);
      expect(p.regex.test('terraform.tfstate.backup')).toBe(true);
    });

    it('SENSITIVE_FILES 中应该有 Terraform 变量文件模式', () => {
      const p = SENSITIVE_FILES.find(f => f.id === 'tfvars');
      expect(p).toBeDefined();
      expect(p.regex.test('terraform.tfvars')).toBe(true);
      expect(p.regex.test('prod.tfvars')).toBe(true);
    });

    it('SENSITIVE_FILES 中应该有 SSH 配置模式', () => {
      const p = SENSITIVE_FILES.find(f => f.id === 'ssh-config');
      expect(p).toBeDefined();
      expect(p.regex.test('.ssh/config')).toBe(true);
    });

    it('SENSITIVE_FILES 中应该有公钥文件模式', () => {
      const p = SENSITIVE_FILES.find(f => f.id === 'pub-key');
      expect(p).toBeDefined();
      expect(p.regex.test('id_rsa.pub')).toBe(true);
    });

    it('BASH_PATTERNS 中应该有 Terraform 文件模式', () => {
      const p = BASH_PATTERNS.find(f => f.id === 'cat-tfstate');
      expect(p).toBeDefined();
      expect(p.regex.test('cat terraform.tfstate')).toBe(true);
    });`;

content = content.replace(
  'expect(CONTENT_PATTERNS.length).toBeGreaterThanOrEqual(15);',
  'expect(CONTENT_PATTERNS.length).toBeGreaterThanOrEqual(15);' + insertAfterContentPatterns
);

// =========== 3. Add Terraform checkFilePath tests after .kube/config test ===========
const tfFilePathTests = `
    // === NEW: Terraform (CRITICAL) ===
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

    it('id_rsa.pub 应该被阻止 (critical)', () => {
      const result = checkFilePath('id_rsa.pub');
      expect(result.blocked).toBe(true);
      expect(result.pattern.level).toBe('critical');
    });

    it('server.pub 应该被阻止 (critical)', () => {
      const result = checkFilePath('server.pub');
      expect(result.blocked).toBe(true);
    });`;

content = content.replace(
  "it('.kube/config 应该被阻止 (critical)', () => {",
  tfFilePathTests + "\n    it('.kube/config 应该被阻止 (critical)', () => {"
);

// =========== 4. Add normal .tf file tests ===========
const normalTfTests = `
    // === NEW: 正常 Terraform 代码文件 ===
    it('main.tf 不应该被阻止', () => {
      const result = checkFilePath('main.tf');
      expect(result.blocked).toBe(false);
    });

    it('variables.tf 不应该被阻止', () => {
      const result = checkFilePath('variables.tf');
      expect(result.blocked).toBe(false);
    });`;

content = content.replace(
  "it('.env.example 不应该被阻止 (白名单)', () => {",
  normalTfTests + "\n    it('.env.example 不应该被阻止 (白名单)', () => {"
);

// =========== 5. Add Terraform Bash command tests ===========
const tfBashTests = `
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
    });`;

content = content.replace(
  "it('cat .aws/credentials 应该被阻止', () => {",
  tfBashTests + "\n    it('cat .aws/credentials 应该被阻止', () => {"
);

// =========== 6. Add normal terraform commands should be allowed ===========
const tfNormalCmdTests = `
    // === NEW: 正常 Terraform 命令 ===
    it('terraform apply 应该被允许', () => {
      const result = checkBashCommand('terraform apply');
      expect(result.blocked).toBe(false);
    });

    it('terraform plan 应该被允许', () => {
      const result = checkBashCommand('terraform plan');
      expect(result.blocked).toBe(false);
    });`;

content = content.replace(
  "it('git status 应该被允许', () => {",
  tfNormalCmdTests + "\n    it('git status 应该被允许', () => {"
);

// =========== 7. Add Terraform check() integration tests ===========
const tfCheckTests = `
    // === NEW: Terraform 集成测试 ===
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

    it('Read main.tf 应该被允许', () => {
      const result = check('Read', { file_path: 'main.tf' });
      expect(result.blocked).toBe(false);
    });`;

content = content.replace(
  "it('Write .env.example 应该被允许 (白名单)', () => {",
  tfCheckTests + "\n    it('Write .env.example 应该被允许 (白名单)', () => {"
);

writeFileSync('.claude/hooks/__tests__/protect-secrets.test.js', content, 'utf8');
console.log('DONE - generated test file, size:', content.length);
console.log('Line count:', content.split('\n').length);