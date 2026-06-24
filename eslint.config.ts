import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';

const tsFiles = ['**/*.{ts,tsx,mts,cts}'];
const hookTsFiles = ['.claude/hooks/**/*.ts'];

export default defineConfig(
  {
    ignores: [
      '**/.venv/**',
      '**/node_modules/**',
      '**/_bmad/**',
      '**/_bmad-output/**',
      'templates/**',
      '.claude/worktrees/**',
      '.claude/hooks/__tests__/**',
      '.claude/hooks/__tests__/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: tsFiles,
    plugins: {
      import: importPlugin,
      security,
      sonarjs,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'error',
      'no-debugger': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: '禁止动态 import()，请在文件顶部静态导入（no-inline-imports）' },
        { selector: "CallExpression[callee.name='require']", message: '禁止 require()，请使用 ESM import' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      // eslint-plugin-import：导入卫生
      'import/first': 'error',
      'import/no-duplicates': 'error',
      'import/no-self-import': 'error',
      'import/no-mutable-exports': 'error',
      // eslint-plugin-security：高信号、低噪声子集
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      // eslint-plugin-sonarjs：确定性 bug 类规则
      'sonarjs/no-identical-expressions': 'error',
      'sonarjs/no-all-duplicated-branches': 'error',
      'sonarjs/no-element-overwrite': 'error',
      'sonarjs/no-unused-collection': 'error',
      'sonarjs/no-gratuitous-expressions': 'error',
    },
  },
  {
    files: hookTsFiles,
    rules: {
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'off',
    },
  },
);
