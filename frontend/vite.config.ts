/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Configuracion de Vite para el frontend de CONTROL v2.
 *
 * - **Tailwind v4** se integra como plugin de Vite (`@tailwindcss/vite`), la
 *   forma recomendada por Tailwind para SPAs con Vite (sin PostCSS aparte).
 * - El alias `@` apunta a `src/` (convencion de shadcn/ui); debe coincidir con
 *   los `paths` de `tsconfig.app.json`.
 * - En desarrollo (`npm run dev`), Vite proxya `/api` al backend local
 *   (puerto 3000) para reproducir el comportamiento del nginx de produccion,
 *   donde `/api` se reenvia al servicio backend por la red interna.
 * - En produccion el bundle se sirve con nginx (ver `nginx.conf.template`); este
 *   proxy solo aplica al servidor de desarrollo.
 * - `test` configura Vitest (entorno jsdom para los componentes de React).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Es una SPA de fundacion (un solo bundle): React + router + query + tabla +
    // radix + better-auth ya rondan el limite por defecto de 500 kB. Cuando los
    // modulos del ERP crezcan se introducira code-splitting por ruta (React.lazy);
    // por ahora se sube el umbral del aviso para no ensuciar el build.
    chunkSizeWarningLimit: 900,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/pruebas/configuracion.ts'],
    css: true,
    // Playwright (carpeta e2e/) corre con su propio runner, no con Vitest.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
