/**
 * Setup global de Vitest para el proyecto "integracion" (PLANMAESTRO §9.2:
 * integración contra Postgres efímero, nunca contra la BD compartida de
 * desarrollo).
 *
 * Levanta UN contenedor Postgres 17 con testcontainers para toda la corrida,
 * le aplica las migraciones reales de `backend/prisma` (`prisma migrate deploy`)
 * y publica la URL vía `provide` para que cada suite cree su cliente.
 * Los archivos de integración corren en serie (ver vitest.config.ts), así que
 * comparten el contenedor sin pisarse.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    /** URL del Postgres efímero de pruebas (testcontainers), con migraciones aplicadas. */
    urlBaseDatosPruebas: string;
  }
}

// Raíz del backend (ahí viven prisma.config.ts y prisma/migrations), resuelta
// desde este archivo: src/pruebas → src → backend.
const raizBackend = fileURLToPath(new URL('../..', import.meta.url));

export default async function entornoGlobal(proyecto: TestProject): Promise<() => Promise<void>> {
  const contenedor: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17',
  ).start();
  const url = contenedor.getConnectionUri();

  // Migraciones reales del backend — el esquema de pruebas es EXACTAMENTE el de
  // producción. `npx` resuelve la prisma local (funciona igual en Windows y Linux).
  // La URL inyectada gana: dotenv (prisma.config.ts) no pisa env existente.
  execSync('npx prisma migrate deploy', {
    cwd: raizBackend,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  proyecto.provide('urlBaseDatosPruebas', url);

  return async () => {
    await contenedor.stop();
  };
}
