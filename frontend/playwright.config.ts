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
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
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
