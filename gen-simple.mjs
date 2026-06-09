import { readFileSync, writeFileSync } from 'fs';

let c = readFileSync('.claude/hooks/__tests__/protect-secrets.test.js', 'utf8');

// Step 1: Update SENSITIVE_FILES count (exact unique line)
c = c.replace(
  "expect(SENSITIVE_FILES.length).toBeGreaterThanOrEqual(20);",
  "expect(SENSITIVE_FILES.length).toBeGreaterThanOrEqual(30);"
);

// Step 2: Update BASH_PATTERNS count (exact unique line)
c = c.replace(
  "expect(BASH_PATTERNS.length).toBeGreaterThanOrEqual(20);",
  "expect(BASH_PATTERNS.length).toBeGreaterThanOrEqual(22);"
);

// Step 3: After CONTENT_PATTERNS test closing });, insert new pattern validation tests
c = c.replace(
  `    it('CONTENT_PATTERNS 应该至少有 15 条规则', () => {
      expect(CONTENT_PATTERNS.length).toBeGreaterThanOrEqual(15);
    });`,
  `    it('CONTENT_PATTERNS 应该至少有 15 条规则', () => {
      expect(CONTENT_PATTERNS.length).toBeGreaterThanOrEqual(15);
    });

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
    });`
);

// Step 4: After .kube/config test block, add Terraform+SSH tests
c = c.replace(
  `    it('.kube/config 应该被阻止 (critical)', () => {
      const result = checkFilePath('.kube/config');
      expect(result.blocked).toBe(true);
    });

    // HIGH 级别`,
  `    it('.kube/config 应该被阻止 (critical)', () => {
      const result = checkFilePath('.kube/config');
      expect(result.blocked).toBe(true);
    });

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
    });

    // HIGH 级别`
);

// Step 5: After .env.example allowlisted test and before 安全级别测试, add normal .tf tests
c = c.replace(
  `    it('.env.example 不应该被阻止 (白名单)', () => {
      const result = checkFilePath('.env.example');
      expect(result.blocked).toBe(false);
    });

    // 安全级别测试`,
  `    it('.env.example 不应该被阻止 (白名单)', () => {
      const result = checkFilePath('.env.example');
      expect(result.blocked).toBe(false);
    });

    // === NEW: 正常 Terraform 代码文件 ===
    it('main.tf 不应该被阻止', () => {
      const result = checkFilePath('main.tf');
      expect(result.blocked).toBe(false);
    });

    it('variables.tf 不应该被阻止', () => {
      const result = checkFilePath('variables.tf');
      expect(result.blocked).toBe(false);
    });

    // 安全级别测试`
);

// Step 6: After cat .aws/credentials, add Terraform Bash command tests
c = c.replace(
  `    it('cat .aws/credentials 应该被阻止', () => {
      const result = checkBashCommand('cat .aws/credentials');
      expect(result.blocked).toBe(true);
    });

    // HIGH - 环境变量泄露`,
  `    it('cat .aws/credentials 应该被阻止', () => {
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
    });

    // HIGH - 环境变量泄露`
);

// Step 7: After git status, add normal terraform commands
c = c.replace(
  `    it('git status 应该被允许', () => {
      const result = checkBashCommand('git status');
      expect(result.blocked).toBe(false);
    });

    // 边界情况`,
  `    it('git status 应该被允许', () => {
      const result = checkBashCommand('git status');
      expect(result.blocked).toBe(false);
    });

    // === NEW: 正常 Terraform 命令 ===
    it('terraform apply 应该被允许', () => {
      const result = checkBashCommand('terraform apply');
      expect(result.blocked).toBe(false);
    });

    it('terraform plan 应该被允许', () => {
      const result = checkBashCommand('terraform plan');
      expect(result.blocked).toBe(false);
    });

    // 边界情况`
);

// Step 8: After Write .env.example (白名单) in check() section, add Terraform tests
c = c.replace(
  `    it('Write .env.example 应该被允许 (白名单)', () => {
      const result = check('Write', { file_path: '.env.example', content: 'SECRET=example' });
      expect(result.blocked).toBe(false);
    });

    // Edit 工具`,
  `    it('Write .env.example 应该被允许 (白名单)', () => {
      const result = check('Write', { file_path: '.env.example', content: 'SECRET=example' });
      expect(result.blocked).toBe(false);
    });

    // === NEW: Terraform 集成测试 ===
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

    it('Read main.tf 应该被允许', () => {
      const result = check('Read', { file_path: 'main.tf' });
      expect(result.blocked).toBe(false);
    });

    // Edit 工具`
);

writeFileSync('.claude/hooks/__tests__/protect-secrets.test.js', c, 'utf8');
console.log('Simple generation complete, size:', c.length);
console.log('Lines:', c.split('\n').length);