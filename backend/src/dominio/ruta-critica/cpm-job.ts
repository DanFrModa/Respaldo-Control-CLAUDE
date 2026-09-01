/**
 * WRAPPER de BD del CPM (F5-E4 — ADR-0013): el HANDLER del job pg-boss `recalcularRutaOrden`. Lee la
 * ruta viva de una orden, calcula sus fechas con el CPM PURO (`cpm.ts`) y las PERSISTE
 * (`fechaPlaneadaOriginal` solo la primera vez, `fechaPlaneadaVigente` y `acumuladoDias` siempre).
 *
 * Innegociables:
 *  • §11 — la captura NUNCA espera esto: corre en segundo plano (pg-boss). `generarRutaOrden` /
 *    `ajustarRutaOrden` (E3) ya encolan el job tras su commit; aquí solo lo consumimos.
 *  • SERIALIZADO por orden (`singletonKey` + la política `stately` de la cola, sin la cual la clave
 *    no restringiría nada) → dos recálculos de la MISMA orden no corren a la vez, y los disparos
 *    seguidos colapsan en uno. Sí puede quedar UNO esperando detrás del que corre: es a propósito,
 *    para que un cambio ocurrido a mitad del recálculo no se pierda.
 *  • IDEMPOTENTE: un reintento del job da el MISMO resultado. Conserva `fechaPlaneadaOriginal`
 *    (snapshot del primer cálculo) y NO toca `fechaReal` ni la captura (las maneja `completarProceso`).
 *  • A2 — la escritura va en UNA transacción. A7 — deja rastro del recálculo en `Bitacora` (sistema).
 *
 * El handler corre SIN `SesionUsuario` (es un proceso de sistema): usa `cargarCalendarioLaboralSinSesion`
 * y `registrarBitacora(tx, null, …)`. El RBAC ya se aplicó cuando el usuario disparó la programación.
 */
import { registrarBitacora } from '../../comun/auditoria.js';
import {
  COLAS_JOBS,
  registrarHandler,
  type PayloadRecalcularRuta,
} from '../../comun/jobs/index.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

import { calcularCpm, type ProcesoCpm } from './cpm.js';
import { cargarCalendarioLaboralSinSesion } from './calendarioLaboral.js';

/**
 * Recalcula y PERSISTE las fechas planeadas de la ruta viva de una orden. Es el cuerpo del handler
 * del job (separado para poder invocarlo directo desde tests/scripts sin pg-boss). Idempotente.
 *
 * @param idOrden   orden cuya ruta se recalcula.
 * @param idEmpresa empresa dueña (A9) — define el calendario laboral a usar.
 * @param bd        contexto de BD opcional (tests de integración apuntan a su contenedor).
 */
export async function recalcularRutaOrden(
  idOrden: number,
  idEmpresa: number,
  bd?: ContextoBd,
): Promise<void> {
  // El calendario se lee FUERA de la transacción de escritura (lectura pura; no necesita el lock).
  const calendario = await cargarCalendarioLaboralSinSesion(idEmpresa, bd);

  await enTransaccion(async (tx) => {
    const orden = await tx.orden.findUnique({
      where: { id: idOrden },
      select: { id: true, rcActiva: true, fechaEntregaRC: true },
    });
    // Si la orden ya no tiene RC activa o no existe, no hay nada que recalcular (idempotente).
    if (orden === null || orden.rcActiva !== true) {
      return;
    }
    // Sin fecha de entrega de la RC no hay ancla para el backward pass: se deja sin fechar (la
    // programación de E3 SIEMPRE fija `fechaEntregaRC`, así que esto es defensivo).
    if (orden.fechaEntregaRC === null) {
      return;
    }

    const filas = await tx.rutaOrden.findMany({
      where: { idOrden },
      include: { antecesores: { select: { idAntecesor: true } } },
    });
    if (filas.length === 0) {
      return;
    }

    const procesos: ProcesoCpm[] = filas.map((f) => ({
      id: f.id,
      duracionDias: f.duracionDias,
      idsAntecesores: f.antecesores.map((a) => a.idAntecesor),
    }));

    const resultado = calcularCpm(procesos, orden.fechaEntregaRC, calendario);

    // Persiste por proceso: fechaPlaneadaOriginal SOLO si está null (snapshot del primer cálculo);
    // fechaPlaneadaVigente y acumuladoDias SIEMPRE. fechaReal/estado/captura NO se tocan (E4 §2).
    for (const fila of filas) {
      const fechas = resultado.fechasPorProceso.get(fila.id);
      if (fechas === undefined) continue;
      await tx.rutaOrden.update({
        where: { id: fila.id },
        data: {
          fechaPlaneadaVigente: fechas.fin,
          acumuladoDias: fechas.acumuladoDias,
          ...(fila.fechaPlaneadaOriginal === null ? { fechaPlaneadaOriginal: fechas.fin } : {}),
        },
      });
    }

    await registrarBitacora(tx, null, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'OTRO',
      datos: {
        operacion: 'recalcular-cpm',
        totalProcesos: filas.length,
        acumuladoTotal: resultado.acumuladoTotal,
        inicioRuta: resultado.inicioRuta.toISOString(),
      },
    });
  }, bd);
}

/**
 * Registra el HANDLER del CPM en el motor de jobs (pg-boss). Lo llama el bootstrap del servidor tras
 * `iniciarMotorJobs`. NO-OP si el motor está inactivo (tests/CI). Los errores del handler se dejan
 * propagar a pg-boss (que reintenta según `encolarJob`); como el cálculo es idempotente, reintentar
 * es seguro.
 */
export async function registrarHandlerCpm(): Promise<void> {
  await registrarHandler<PayloadRecalcularRuta>(COLAS_JOBS.recalcularRutaOrden, async (payload) => {
    await recalcularRutaOrden(payload.idOrden, payload.idEmpresa);
  });
}
