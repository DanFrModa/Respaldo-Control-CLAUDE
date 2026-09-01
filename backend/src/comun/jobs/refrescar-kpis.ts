/**
 * REFRESCO de las VISTAS MATERIALIZADAS de KPIs (F7-E3, plan §11; doc `08-Ruta-Critica.md` §4.4,
 * `09-Control-de-Calidad.md` §5.3, MEJORAS 03-WIP; D11). Espejo de `riesgo-rc.ts`: un CUERPO testeable
 * (`refrescarKpis`) que hace el trabajo real, y un `registrarRefrescoKpis` que lo cablea a pg-boss
 * (worker + cron). El cálculo PESADO de los tableros directivos vive en las vistas (SQL crudo, ver la
 * migración `20260703140000_f7_e3_kpis`); este job solo las REFRESCA. La CAPTURA nunca espera el
 * recálculo: las pantallas leen la vista ya materializada + el sello "datos al:" de `KpiRefresco`.
 *
 * ⚠️ `REFRESH MATERIALIZED VIEW CONCURRENTLY` NO puede correr dentro de una transacción y exige un
 * índice ÚNICO en la vista (ambos cubiertos: se refresca sobre el cliente PLANO, nunca `tx`, y cada
 * vista tiene su unique index en la migración). Es CONCURRENTE para no bloquear las lecturas mientras
 * refresca; si por alguna razón fallara (p. ej. una vista aún no populada), cae a un REFRESH normal
 * (que sí bloquea el instante del refresco, aceptable en un job de fondo).
 *
 * GUARDA POR ENTORNO: `registrarRefrescoKpis` es NO-OP si el motor de jobs está inactivo (tests/CI).
 * Lo testeable sin pg-boss es el CUERPO (`refrescarKpis(bd)`), que se invoca directo con su `bd`.
 */
import { prisma } from '../../datos/index.js';
import type { ContextoBd } from '../transaccion.js';

import { COLAS_JOBS, motorJobs } from './index.js';

/** Cron del refresco recurrente. Default: cada 20 min. Configurable por `KPIS_CRON`. */
const CRON_REFRESCO = process.env.KPIS_CRON ?? '*/20 * * * *';

/**
 * Vistas materializadas de KPIs (mismo orden que la migración). Nombres FIJOS del código (no vienen
 * de entrada del usuario): se interpolan en el DDL de forma segura porque son literales controlados.
 */
const VISTAS_KPI = [
  'kpi_entregas_a_tiempo',
  'kpi_lead_time_proceso',
  'kpi_cuellos_botella',
  'kpi_desempeno_responsable',
  'kpi_calidad_maquilero',
  'kpi_defecto_maquilero',
  'kpi_wip',
] as const;

/**
 * CUERPO del refresco (sin pg-boss): refresca cada vista materializada y estampa el timestamp de
 * `KpiRefresco` (fila singleton `clave='global'`). Idempotente. NO debe envolverse en transacción
 * (CONCURRENTLY lo prohíbe): usa el cliente PLANO (`bd.cliente` o el singleton), nunca `bd.tx`.
 *
 * @param bd  contexto de BD opcional (tests de integración apuntan a su contenedor por `cliente`).
 */
export async function refrescarKpis(bd?: ContextoBd): Promise<void> {
  const cliente = bd?.cliente ?? prisma;
  for (const vista of VISTAS_KPI) {
    try {
      await cliente.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${vista}"`);
    } catch {
      // Fallback (no concurrente): cubre el primer poblado o cualquier caso donde CONCURRENTLY no
      // aplique. Bloquea las lecturas SOLO el instante del refresco (aceptable en un job de fondo).
      await cliente.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW "${vista}"`);
    }
  }
  const ahora = new Date();
  await cliente.kpiRefresco.upsert({
    where: { clave: 'global' },
    create: { clave: 'global', refrescadoEn: ahora },
    update: { refrescadoEn: ahora },
  });
}

/**
 * Cablea el refresco a pg-boss: registra el WORKER de la cola (lo consumen tanto el `schedule` cron
 * como los envíos on-demand del endpoint `POST /api/indicadores/refrescar`) y programa el cron
 * recurrente. Idempotente (re-programar la misma cola/cron reemplaza el schedule). NO-OP si el motor
 * de jobs está inactivo (tests/CI). Best-effort: si pg-boss no responde, se registra y la app sigue.
 *
 * @param registrarError hook para logear (el servidor inyecta el suyo).
 */
export async function registrarRefrescoKpis(
  registrarError: (mensaje: string, error: unknown) => void = (msg, err) => {
    console.error(msg, err);
  },
): Promise<void> {
  const boss = motorJobs();
  if (boss === null) {
    return; // motor inactivo (tests/CI): nada que programar.
  }
  try {
    await boss.work(COLAS_JOBS.refrescarKpis, { localConcurrency: 1, batchSize: 1 }, async () => {
      await refrescarKpis();
    });
    // schedule (cron) recurrente. pg-boss lo guarda con clave (cola, key) y `key` va vacía aquí:
    // re-programar en cada arranque REEMPLAZA el schedule anterior (upsert), no lo duplica ni deja
    // dos crons vivos para esta cola. Cambiar `KPIS_CRON` y reiniciar basta para que aplique.
    await boss.schedule(COLAS_JOBS.refrescarKpis, CRON_REFRESCO);
  } catch (error) {
    registrarError('No se pudo programar el refresco de KPIs (la app sigue):', error);
  }
}
