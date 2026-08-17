/** Andamio TEMPORAL: globalSetup contra un Postgres NATIVO (no testcontainers). Se borra al final. */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

const raizBackend = fileURLToPath(new URL('../..', import.meta.url));

export default function entornoGlobal(proyecto: TestProject): () => Promise<void> {
  const url = process.env.URL_PG_NATIVO ?? '';
  execSync('npx prisma migrate deploy', {
    cwd: raizBackend,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
  proyecto.provide('urlBaseDatosPruebas', url);
  return () => Promise.resolve();
}
