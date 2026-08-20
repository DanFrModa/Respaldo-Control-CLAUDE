// TEMPORAL (no se comitea): globalSetup que apunta la suite de integración a un Postgres NATIVO ya
// levantado, en vez de arrancar testcontainers/Docker.
import type { TestProject } from 'vitest/node';

export default function entornoGlobal(proyecto: TestProject): void {
  proyecto.provide(
    'urlBaseDatosPruebas',
    process.env.URL_PG_NATIVA ?? 'postgresql://postgres@127.0.0.1:55432/control_pruebas',
  );
}
