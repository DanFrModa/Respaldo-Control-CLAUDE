// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Configuracion plana (flat config) de ESLint para el frontend.
 *
 * Los plugins de React (hooks y fast-refresh) se registran como objetos en la
 * clave `plugins` (formato flat de ESLint 10); no se usan sus presets
 * `recommended-*` porque algunos todavia declaran `plugins` como arreglo de
 * strings (formato viejo, rechazado por ESLint 10). Las reglas relevantes se
 * activan aqui explicitamente.
 *
 * `eslint-config-prettier` va al final para no pelear con Prettier.
 */
export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Archivos de configuracion JS: sin reglas que requieran tipos.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
