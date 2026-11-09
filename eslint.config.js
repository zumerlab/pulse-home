import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/dist-card/**', '**/dist-openhab/**', '**/dist-pages/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Node scripts (the Home Assistant development helpers, the openHAB recorder, the openHAB stand-in the tests read).
  { files: ['**/scripts/**/*.mjs', 'tests/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', WebSocket: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', AbortSignal: 'readonly' } } },
];
