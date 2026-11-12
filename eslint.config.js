// Flat ESLint config. The no-restricted-imports blocks enforce the dependency table in
// docs/ARCHITECTURE.md; packages/checks/src/boundaries.test.ts proves a forbidden import fails.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const internal = (allowed, extra = []) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['@bountyline/*', ...allowed.map((a) => `!@bountyline/${a}`)],
          message: 'Dependency rule (docs/ARCHITECTURE.md): this package may not import that one.',
        },
        ...extra,
      ],
    },
  ],
});

const noNode = {
  group: ['node:*', 'fs', 'path', 'crypto', 'http', 'https', 'os', 'child_process'],
  message: 'packages/core is pure: no Node modules.',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/db/migrations/**',
      '.data/**',
      'eval/**',
      'design/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node }, ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  { files: ['packages/contracts/**/*.ts'], rules: internal([]) },
  {
    files: ['packages/core/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: internal(['contracts'], [noNode]),
  },
  { files: ['packages/core/**/*.test.ts'], rules: internal(['contracts']) },
  { files: ['packages/config/**/*.ts'], rules: internal(['contracts', 'core']) },
  { files: ['packages/db/**/*.ts'], rules: internal(['contracts', 'core']) },
  // Test builders load the demo program files.
  { files: ['packages/db/test/**/*.ts'], rules: internal(['contracts', 'core', 'config']) },
  { files: ['packages/paypal/**/*.ts'], rules: internal(['core', 'config']) },
  { files: ['packages/checks/**/*.ts'], rules: internal(['contracts', 'core', 'config', 'db']) },
  {
    files: ['apps/workflows/**/*.ts'],
    rules: internal(['contracts', 'core', 'config', 'db', 'checks']),
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: internal(['contracts', 'core', 'config', 'db', 'paypal', 'checks']),
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: internal(['contracts']),
  },
  { files: ['scripts/**/*.ts'], rules: { 'no-console': 'off' } },
);
