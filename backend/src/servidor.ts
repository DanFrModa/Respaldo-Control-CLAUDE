import { construirApp } from './app.js';
import { detenerColaEventos, iniciarColaEventos } from './comun/cola-eventos.js';
import { detenerMotorJobs, iniciarMotorJobs } from './comun/jobs/index.js';
import { registrarHandlerCpm } from './dominio/ruta-critica/cpm-job.js';
import { registrarBarridoRiesgoRc } from './comun/jobs/riesgo-rc.js';

/**
 * Punto de entrada del servicio de API.
 *
 * Arranca Fastify escuchando en `::` (dual-stack IPv4 + IPv6), requisito de la
 * red privada de Railway (PLANMAESTRO §2.2), y en el puerto `PORT` (3000 por
 * defecto). Maneja un apagado limpio ante SIGINT/SIGTERM para que Docker y
 * Railway puedan reiniciar/parar el contenedor sin dejar conexiones colgadas.
 *
 * También arranca/cierra la COLA de eventos (pg-boss sobre el MISMO Postgres,
 * F4-E3 / ADR-0011): el relay del outbox publica los eventos de dominio. Vive en
 * el entry point (no en `app.ts`) para que los tests, que construyen la app con
 * `inject()`, NO requieran un pg-boss vivo. Se guarda además por `EVENTOS_COLA_ACTIVA`.
 */

const PUERTO = Number(process.env.PORT ?? 3000);
const HOST = '::';

const app = await construirApp({ logBonito: process.env.NODE_ENV !== 'production' });

// Arranque de la cola de eventos (best-effort: si pg-boss no levanta, la app sigue y el outbox
// no se pierde — el barrido reintentará). NO-OP en tests/CI (EVENTOS_COLA_ACTIVA=false).
await iniciarColaEventos((mensaje, error) => {
  app.log.error({ error }, mensaje);
});

// Arranque del MOTOR DE JOBS (pg-boss sobre el mismo Postgres, F5-E3 / ADR-0012): tareas durables
// en segundo plano (CPM de la RC, E4; auto-avance, E6). Best-effort; NO-OP en tests/CI
// (JOBS_ACTIVOS=false). En E3 solo se ENCOLA el recálculo; el worker del CPM lo monta E4.
await iniciarMotorJobs((mensaje, error) => {
  app.log.error({ error }, mensaje);
});

// Registra los HANDLERS de jobs de la Ruta Crítica (F5-E4): el CPM (recálculo de fechas de la ruta
// viva, serializado por orden) y el BARRIDO RECURRENTE de riesgo (recalcula el semáforo de las
// órdenes con RC activa, incl. la regla "EnRiesgo antes de programar"). NO-OP si el motor está
// inactivo (tests/CI). Best-effort: si fallan, la app sigue (el job se puede re-disparar).
await registrarHandlerCpm();
await registrarBarridoRiesgoRc((mensaje, error) => {
  app.log.error({ error }, mensaje);
});

/** Cierra la app de forma ordenada y termina el proceso. */
async function apagar(senal: NodeJS.Signals): Promise<void> {
  app.log.info({ senal }, 'Apagando el servidor...');
  try {
    await detenerColaEventos();
    await detenerMotorJobs();
    await app.close();
    app.log.info('Servidor apagado correctamente.');
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, 'Error durante el apagado.');
    process.exit(1);
  }
}

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    void apagar(senal);
  });
}

try {
  await app.listen({ host: HOST, port: PUERTO });
} catch (error) {
  app.log.error({ error }, 'No se pudo iniciar el servidor.');
  process.exit(1);
}
