import { defineConfig, devices } from '@playwright/test';

/**
 * Configuracion de Playwright (pruebas E2E del frontend de CONTROL v2).
 *
 * Las pruebas corren contra el STACK COMPLETO ya levantado (frontend nginx +
 * backend + postgres) en `http://localhost:8080`. Antes de `npm run test:e2e`:
 *
 *   docker compose up -d --build      # desde la raiz del repo
 *
 * `BASE_URL` permite apuntar a otro origen (p. ej. el ambiente de prueba). No se
 * usa `webServer` porque el sistema se levanta con Docker, no con `vite dev`.
 */
const baseURL = process.env.BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e',
  // Las pruebas comparten un usuario (admin) y mutan datos: se corren en serie
  // para que el orden (login -> CRUD) sea determinista y no haya choques.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // En CI, además del `list` de siempre y del reporte HTML (que se sube como artefacto):
  //  • `github`: emite anotaciones `::error` con el archivo/línea del fallo, visibles en la UI del
  //    run Y en el log crudo del job.
  //  • `json`: deja `test-results/resultados.json` (carpeta ya ignorada por git), del que el paso
  //    "Resumen de fallos" del workflow saca la lista compacta al FINAL del log — el volcado de
  //    `docker compose logs` es largo y, sin ese resumen al final, la salida de las pruebas queda
  //    fuera de la ventana de log que la API de GitHub deja leer (y el artefacto no siempre se
  //    puede descargar).
  reporter: process.env.CI
    ? [
        ['list'],
        ['github'],
        ['json', { outputFile: 'test-results/resultados.json' }],
        ['html', { open: 'never' }],
      ]
    : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
