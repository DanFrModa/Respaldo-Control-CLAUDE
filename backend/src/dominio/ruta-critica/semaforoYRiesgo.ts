/**
 * SEMÁFORO de cumplimiento de la Ruta Crítica (F5-E4 — ADR-0013; doc `08-Ruta-Critica.md` §4
 * "capacidad 6/7"; D11). Compara HOY contra la `fechaPlaneadaVigente` de cada proceso para clasificar
 * el avance en tres estados:
 *
 *  • `aTiempo`  — el proceso ya se cumplió (tiene `fechaReal`), o su fecha planeada aún no apremia.
 *  • `enRiesgo` — sin cumplir y su fecha planeada está CERCA (dentro del umbral de días naturales), o
 *                 la orden todavía no se programó pero su inicio requerido ya pasó / está por pasar.
 *  • `atrasado` — sin cumplir y su fecha planeada vigente YA venció (HOY > planeada).
 *
 * La parte de cálculo es PURA (sin Prisma): se prueba directo con fechas a mano. El barrido recurrente
 * (`comun/jobs/riesgo-rc.ts`) y el GET de la ruta (`rutaOrden`) la consumen.
 *
 * "EnRiesgo nace ANTES de programar" (regla del viejo): una orden a la que ya se le asignó
 * artículo+fechaEntregaRC pero cuya RC aún no se generó cuenta como EN RIESGO si la fecha de entrega
 * apremia (la ventana para arrancar la producción ya se está cerrando). Esa evaluación SIN ruta se
 * resuelve en {@link evaluarRiesgoOrdenSinRuta}.
 */

/** Estado del semáforo de un proceso o de una orden. */
export type EstadoSemaforo = 'aTiempo' | 'enRiesgo' | 'atrasado';

/**
 * Umbral (en DÍAS NATURALES) dentro del cual un proceso sin cumplir, cuya fecha planeada se acerca,
 * pasa a `enRiesgo`. 3 días es la ventana de aviso estándar de la planeación (ex `EsUrgente` del
 * viejo usaba +7 para "URGENTE"; aquí afinamos a 3 para el semáforo de proceso, documentado en el
 * ADR-0013). Si HOY ya pasó la planeada → `atrasado` (manda sobre el umbral).
 */
export const UMBRAL_RIESGO_DIAS = 3;

/** Trunca una fecha a medianoche UTC (solo el día calendario importa para el semáforo). */
function aMedianocheUtc(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/** Días naturales (UTC) de `a` a `b` (positivo si `b` es posterior). */
function diasNaturalesEntre(a: Date, b: Date): number {
  const MS_DIA = 24 * 60 * 60 * 1000;
  return Math.round((aMedianocheUtc(b).getTime() - aMedianocheUtc(a).getTime()) / MS_DIA);
}

/** Datos mínimos de un proceso para evaluar su semáforo. */
export interface ProcesoParaSemaforo {
  /** Fecha planeada vigente (la calcula el CPM, E4); null si aún no se ha fechado. */
  fechaPlaneadaVigente: Date | null;
  /** Fecha real de cumplimiento; si la tiene, el proceso está cumplido (a tiempo). */
  fechaReal: Date | null;
}

/**
 * Estado del semáforo de UN proceso comparando HOY contra su fecha planeada vigente.
 *  • Con `fechaReal` → `aTiempo` (cumplido; el detalle de "se cumplió tarde" es de KPIs, no del semáforo).
 *  • Sin planeada (aún no fechado por el CPM) → `aTiempo` (no se puede juzgar todavía).
 *  • HOY > planeada → `atrasado`.
 *  • planeada dentro de `UMBRAL_RIESGO_DIAS` días → `enRiesgo`.
 *  • si no → `aTiempo`.
 */
export function estadoSemaforoProceso(proceso: ProcesoParaSemaforo, hoy: Date): EstadoSemaforo {
  if (proceso.fechaReal !== null) return 'aTiempo';
  if (proceso.fechaPlaneadaVigente === null) return 'aTiempo';
  const dias = diasNaturalesEntre(hoy, proceso.fechaPlaneadaVigente);
  if (dias < 0) return 'atrasado';
  if (dias <= UMBRAL_RIESGO_DIAS) return 'enRiesgo';
  return 'aTiempo';
}

/**
 * Estado del semáforo de la ORDEN = el PEOR de sus procesos (`atrasado` > `enRiesgo` > `aTiempo`):
 * basta un proceso atrasado para que la orden lo esté. Una orden sin procesos pendientes (todos
 * cumplidos) sale `aTiempo`.
 */
export function estadoSemaforoOrden(
  procesos: readonly ProcesoParaSemaforo[],
  hoy: Date,
): EstadoSemaforo {
  let peor: EstadoSemaforo = 'aTiempo';
  for (const p of procesos) {
    const estado = estadoSemaforoProceso(p, hoy);
    if (estado === 'atrasado') return 'atrasado';
    if (estado === 'enRiesgo') peor = 'enRiesgo';
  }
  return peor;
}

/**
 * Evalúa el riesgo de una orden a la que ya se le asignó `fechaEntregaRC` pero cuya RC NO se ha
 * generado (regla "EnRiesgo nace antes de programar"). Sin ruta no hay procesos que comparar, así
 * que se mira la fecha de entrega: si ya pasó → `atrasado`; si apremia (dentro del umbral) →
 * `enRiesgo`; si aún hay margen → `aTiempo`. Sin `fechaEntregaRC` no hay nada que juzgar → `aTiempo`.
 */
export function evaluarRiesgoOrdenSinRuta(fechaEntregaRC: Date | null, hoy: Date): EstadoSemaforo {
  if (fechaEntregaRC === null) return 'aTiempo';
  const dias = diasNaturalesEntre(hoy, fechaEntregaRC);
  if (dias < 0) return 'atrasado';
  if (dias <= UMBRAL_RIESGO_DIAS) return 'enRiesgo';
  return 'aTiempo';
}

/** ¿El estado del semáforo cuenta como "en riesgo" para la bandera booleana `Orden.enRiesgo`? */
export function esRiesgoso(estado: EstadoSemaforo): boolean {
  return estado === 'enRiesgo' || estado === 'atrasado';
}
