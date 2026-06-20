import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const tsFiles = ['**/*.{ts,tsx,mts,cts}'];
const hookJsFiles = ['.claude/hooks/**/*.js'];

export default [
  {
    ignores: [
      '**/.venv/**',
      '**/node_modules/**',
      '**/_bmad/**',
      '**/_bmad-output/**',
      '.claude/worktrees/**',
      '.claude/hooks/__tests__/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict.map((config) => ({
    ...config,
    files: config.files ?? tsFiles,
  })),
  {
    files: tsFiles,
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'error',
      'no-debugger': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
    },
  },
  {
    files: hookJsFiles,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        Bun: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'off',
      'no-unused-vars': 'off',
    },
  },
];
