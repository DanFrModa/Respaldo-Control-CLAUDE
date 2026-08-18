// ANDAMIO TEMPORAL del coder (V1-E3g) — NO va al repo, se borra al terminar. Apunta el proyecto de
// integración al Postgres NATIVO desechable en vez de testcontainers (Docker local está prohibido).
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'integracion-local',
    include: ['src/**/*.int.test.ts', 'migracion/**/*.int.test.ts'],
    globalSetup: ['/tmp/claude-0/-home-user-Respaldo-Control-CLAUDE/101a0fce-1c7b-52e6-8307-6f8f115a67e9/scratchpad/entorno-local-e3g.ts'],
    setupFiles: ['./src/pruebas/preparar-entorno.ts'],
    fileParallelism: false,
    testTimeout: 90000,
    hookTimeout: 180000,
  },
});
