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
  {
    // `esquema.gen.ts` es codigo GENERADO (openapi-typescript): no se lintea.
    ignores: ['dist/', 'node_modules/', 'src/api/esquema.gen.ts', 'playwright-report/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // Codigo de la app (con informacion de tipos).
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
      // TS strict de verdad: prohibido evadir el chequeo de nulos con `!`
      // (PLANMAESTRO §1 / spec E4: "TS strict sin any/!"). Se estrecha el tipo.
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Primitivas de shadcn/ui (vendoreadas): exportan a proposito sus `*Variants`
  // junto al componente; la advertencia de fast-refresh no aplica a estos
  // archivos de UI que no se editan a mano.
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Pruebas E2E de Playwright: TypeScript, entorno Node, sin info de tipos.
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Scripts de build/generacion (Node, sin info de tipos).
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.js', '*.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettier,
);
