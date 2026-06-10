// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Configuracion plana (flat config) de ESLint para el backend.
 * `eslint-config-prettier` va al final para desactivar reglas de formato que
 * pelearian con Prettier.
 */
export default tseslint.config(
  // El cliente Prisma de `src/datos/generated/` es codigo generado (lleva su propio
  // @ts-nocheck): no se lintea ni se le exige el estilo del proyecto.
  { ignores: ['dist/', 'node_modules/', 'src/datos/generated/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Un ERP no puede dejar promesas al aire: toda operacion async se espera o se maneja.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Imports de tipos explicitos (verbatimModuleSyntax esta activado en tsconfig).
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Los archivos de configuracion JS/MJS no forman parte del proyecto TS: se les
  // apagan las reglas que necesitan informacion de tipos.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
