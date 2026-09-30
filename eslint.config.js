import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // shared/ must stay free of DOM and Node APIs.
    files: ['shared/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'self',
        'process',
        'require',
        'localStorage',
        'performance',
        'setTimeout',
        'setInterval',
      ],
    },
  },
  {
    // GameHost and the simulation must stay transport- and environment-agnostic.
    files: ['host/src/**/*.ts'],
    ignores: ['host/src/transport/webrtc.ts', 'host/src/transport/workerBridge.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'process', 'require', 'localStorage'],
      'no-restricted-imports': ['error', { patterns: ['peerjs', 'node:*'] }],
    },
  },
);
