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
          // Los unit de impresos generan PDFs y Excel de verdad (@react-pdf/renderer, exceljs) y
          // cruzan por el pool de workers: bajo la carga en paralelo del suite eso satura CPU.
          // `PDF_WORKER_POOL=1` baja los hilos por archivo y un timeout holgado absorbe el arranque
          // en frío del pool y la contención (el grueso de los unit siguen siendo pruebas puras que
          // terminan en ms).
          //
          // `testTimeout` es el ÚNICO tope de estas pruebas: NINGÚN archivo de render debe llevar el
          // suyo. Varios tenían `20_000` —POR DEBAJO de este default— y eran los primeros en caer
          // cuando el runner iba cargado (se cayeron dos corridas de CI seguidas con
          // `impreso-inventario-telas`, `excel-reporte-fiscal` y `pdf-worker`, que aislados pasan de
          // sobra). Medido en local: la prueba de render más pesada ronda los 2-7 s, así que 40 s
          // deja ~6× de margen para un runner lento y con jobs en paralelo. Subirlo NO relaja
          // ninguna aserción: el corte que esas pruebas ejercitan es
          // `PDF_WORKER_TIMEOUT_MS`/`EXCEL_WORKER_TIMEOUT_MS`, que ellas fijan aparte.
          env: { PDF_WORKER_POOL: '1' },
          testTimeout: 40_000,
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
