import { defineConfig } from 'vitest/config';

// Dos proyectos de prueba (PLANMAESTRO §9.2: unit de reglas + integración contra Postgres efímero):
//  - "unit":        *.test.ts        — reglas puras, sin base de datos, corren en paralelo.
//  - "integracion": *.int.test.ts    — contra Postgres 17 real (testcontainers + migraciones
//                                      de backend/prisma). Comparten un solo contenedor, por eso
//                                      los archivos corren en serie (fileParallelism: false).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integracion',
          include: ['src/**/*.int.test.ts'],
          globalSetup: ['./src/pruebas/entorno-global.ts'],
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
