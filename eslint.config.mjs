import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', 'evidence/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly', WebSocket: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', console: 'readonly', URL: 'readonly',
      },
    },
  },
  {
    files: ['web/*.js'],
    languageOptions: { globals: {
      document: 'readonly', window: 'readonly', Event: 'readonly',
      setTimeout: 'readonly', fetch: 'readonly',
      loadRecords: 'readonly', showComparison: 'readonly',
    } },
  },
];
