import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/generated/**', '**/.output*/**', '**/.wxt/**', '**/tmp/**', '**/research/repos/**', '**/experiments/**', '**/docs/course/**'] },
  { ...js.configs.recommended, files: ['packages/**/*.{js,mjs}', 'apps/**/*.{js,mjs}', 'scripts/**/*.mjs', 'tests/**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', setTimeout: 'readonly' } } },
  ...tseslint.configs.recommended,
];