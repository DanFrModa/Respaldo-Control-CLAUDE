import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Configuracion de Vite para el frontend de CONTROL v2.
 *
 * - En desarrollo (`npm run dev`), Vite proxya `/api` al backend local
 *   (puerto 3000) para reproducir el comportamiento del nginx de produccion,
 *   donde `/api` se reenvia al servicio backend por la red interna.
 * - En produccion el bundle se sirve con nginx (ver `nginx.conf`); este proxy
 *   solo aplica al servidor de desarrollo.
 */
export default defineConfig({
  plugins: [react()],
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
  },
});
