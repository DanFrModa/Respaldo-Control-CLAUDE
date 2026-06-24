/**
 * BARRIDO RECURRENTE del SEMÁFORO de riesgo de la Ruta Crítica (F5-E4 — ADR-0013; doc
 * `08-Ruta-Critica.md` §4). El semáforo de un proceso depende de HOY, así que NO basta con
 * recalcularlo al capturar: una orden puede pasar a "en riesgo"/"atrasada" SOLO porque el tiempo
 * avanzó. Este job recorre periódicamente las órdenes de la RC y actualiza su bandera `Orden.enRiesgo`.
 *
 * Cubre la regla "EnRiesgo nace ANTES de programar": una orden con `fechaEntregaRC` cuya RC todavía
 * NO se generó también entra al barrido (se evalúa por su fecha de entrega, `evaluarRiesgoOrdenSinRuta`).
 *
 * Se programa como job RECURRENTE de pg-boss (`schedule`, cron). El handler NO toca el servicio de
 * órdenes de F2: solo escribe la bandera `enRiesgo` (campo conservado de v1, reutilizado por v2).
 *
 * GUARDA POR ENTORNO: NO-OP si el motor de jobs está inactivo (tests/CI). Lo testeable sin pg-boss es
 * el CUERPO del barrido (`barrerRiesgoRc`), que se invoca directo en integración con su `bd`.
 */
import { prisma } from '../../datos/index.js';
import { registrarBitacora } from '../auditoria.js';
import {
  esRiesgoso,
  estadoSemaforoOrden,
  evaluarRiesgoOrdenSinRuta,
} from '../../dominio/ruta-critica/semaforoYRiesgo.js';
import { enTransaccion, type ContextoBd } from '../transaccion.js';

import { COLAS_JOBS, motorJobs } from './index.js';

/** Cron del barrido recurrente. Default: cada hora en punto. Configurable por `RC_RIESGO_CRON`. */
const CRON_BARRIDO = process.env.RC_RIESGO_CRON ?? '0 * * * *';

/** Tope de órdenes que procesa un barrido (acota la carga; sobra para el volumen de la RC viva). */
const LOTE_BARRIDO = 5_000;

/** Hoy a medianoche UTC (el semáforo solo mira el día calendario). */
function hoyUtc(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/**
 * CUERPO del barrido (sin pg-boss): recalcula el semáforo de las órdenes de la RC y actualiza
 * `Orden.enRiesgo` cuando cambia. Devuelve cuántas órdenes cambiaron de estado. Idempotente.
 *
 * Selecciona órdenes con RC activa (tienen ruta viva que comparar) Y órdenes con `fechaEntregaRC`
 * pero RC no activa (la regla "en riesgo antes de programar"). Solo escribe cuando el valor difiere
 * del actual (evita writes y bitácora inútiles).
 *
 * @param bd  contexto de BD opcional (tests de integración apuntan a su contenedor).
 */
export async function barrerRiesgoRc(bd?: ContextoBd): Promise<number> {
  const hoy = hoyUtc();
  const cliente = bd?.tx ?? bd?.cliente ?? prisma;

  const ordenes = await cliente.orden.findMany({
    where: {
      OR: [{ rcActiva: true }, { fechaEntregaRC: { not: null } }],
    },
    select: {
      id: true,
      rcActiva: true,
      enRiesgo: true,
      fechaEntregaRC: true,
      rutaProcesos: {
        select: { fechaPlaneadaVigente: true, fechaReal: true },
      },
    },
    take: LOTE_BARRIDO,
  });

  let cambiadas = 0;
  for (const orden of ordenes) {
    const estado =
      orden.rcActiva === true
        ? estadoSemaforoOrden(orden.rutaProcesos, hoy)
        : evaluarRiesgoOrdenSinRuta(orden.fechaEntregaRC, hoy);
    const enRiesgo = esRiesgoso(estado);
    if (orden.enRiesgo === enRiesgo) {
      continue; // sin cambio: no se escribe.
    }
    await enTransaccion(async (tx) => {
      await tx.orden.update({ where: { id: orden.id }, data: { enRiesgo } });
      await registrarBitacora(tx, null, {
        entidad: 'Orden',
        idEntidad: orden.id,
        accion: 'OTRO',
        datos: { operacion: 'barrido-riesgo-rc', estado, enRiesgo },
      });
    }, bd);
    cambiadas += 1;
  }
  return cambiadas;
}

/**
 * Programa el barrido RECURRENTE en pg-boss (`schedule` con cron) y registra su handler. Idempotente
 * (re-programar la misma cola/cron reemplaza el schedule). NO-OP si el motor de jobs está inactivo
 * (tests/CI) — no hay pg-boss vivo. Best-effort: si pg-boss no responde, se registra y la app sigue.
 *
 * @param registrarError hook para logear (el servidor inyecta el suyo).
 */
export async function registrarBarridoRiesgoRc(
  registrarError: (mensaje: string, error: unknown) => void = (msg, err) => {
    console.error(msg, err);
  },
): Promise<void> {
  const boss = motorJobs();
  if (boss === null) {
    return; // motor inactivo (tests/CI): nada que programar.
  }
  try {
    await boss.work(COLAS_JOBS.barridoRiesgoRc, { localConcurrency: 1, batchSize: 1 }, async () => {
      await barrerRiesgoRc();
    });
    // schedule (cron) recurrente; pg-boss dedup por cola+cron.
    await boss.schedule(COLAS_JOBS.barridoRiesgoRc, CRON_BARRIDO);
  } catch (error) {
    registrarError('No se pudo programar el barrido de riesgo de la RC (la app sigue):', error);
  }
}
