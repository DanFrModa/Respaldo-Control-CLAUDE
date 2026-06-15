import { defineConfig } from 'vitest/config';

// Dos proyectos de prueba (PLANMAESTRO §9.2: unit de reglas + integración contra Postgres efímero):
//  - "unit":        *.test.ts        — reglas puras, sin base de datos, corren en paralelo.
//  - "integracion": *.int.test.ts    — contra Postgres 17 real (testcontainers + migraciones
//                                      de backend/prisma). Comparten un solo contenedor, por eso
//                                      los archivos corren en serie (fileParallelism: false).
// El ETL de migración (F1-E6) vive en `migracion/` (fuera de `src/`), así que sus pruebas se
// incluyen aquí explícitamente: unit en `migracion/**/*.test.ts`, integración en `*.int.test.ts`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'migracion/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts', 'migracion/**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integracion',
          include: ['src/**/*.int.test.ts', 'migracion/**/*.int.test.ts'],
          globalSetup: ['./src/pruebas/entorno-global.ts'],
          // Fija DATABASE_URL/secretos en el worker ANTES de importar cada suite,
          // para que el singleton de Prisma y better-auth apunten al contenedor.
          setupFiles: ['./src/pruebas/preparar-entorno.ts'],
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
