/**
 * MOTOR de JOBS en segundo plano sobre pg-boss (F5-E3 — ADR-0012). Es la infraestructura COMÚN
 * para tareas asíncronas durables: el CPM de la Ruta Crítica (E4), el auto-avance por eventos (E6)
 * y cualquier trabajo futuro que no deba bloquear la respuesta HTTP.
 *
 * Decisiones de diseño (ADR-0012):
 *  • Una sola instancia de pg-boss para TODA la app, sobre el MISMO Postgres (`DATABASE_URL`) —
 *    no se introduce otro broker; misma decisión que la cola de eventos (ADR-0011).
 *  • SERIALIZACIÓN POR ORDEN vía `singletonKey`: dos jobs del MISMO recurso (p. ej. recalcular la
 *    RC de la orden 42) NO se procesan a la vez ni se acumulan en cola. pg-boss garantiza que, para
 *    un `singletonKey` dado, a lo sumo UN job está en estado `created`/`active`; un segundo `send`
 *    con la misma clave mientras hay uno pendiente se descarta (dedup). Así, varios eventos seguidos
 *    sobre la misma orden colapsan en un único recálculo (el último gana) en vez de pisarse.
 *  • GUARDA POR ENTORNO: el worker arranca SOLO si `JOBS_ACTIVOS` no está en "false". En tests/CI se
 *    deja INACTIVO (no hay pg-boss vivo) — lo testeable sin BD es la CONSTRUCCIÓN de la singletonKey
 *    y la serialización; el transporte real se prueba en integración/Railway. Con el motor inactivo,
 *    `encolarJob` es un no-op silencioso que devuelve `null` (nadie se rompe).
 *
 * En E3 el handler del CPM NO se implementa (es E4): aquí se registra el NOMBRE de la cola y se deja
 * que `generarRutaOrden` ENCOLE el recálculo. El worker que consume esa cola lo monta E4.
 */
import { PgBoss } from 'pg-boss';

/** Nombres de las colas de jobs de la app. Centralizados para que productor y consumidor coincidan. */
export const COLAS_JOBS = {
  /**
   * Recálculo del CPM (fechas planeadas) de la RUTA VIVA de una orden. Lo ENCOLA `generarRutaOrden`
   * / `ajustarRutaOrden` (F5-E3); el HANDLER que calcula las fechas lo implementa E4.
   */
  recalcularRutaOrden: 'rc-recalcular-ruta',
  /**
   * BARRIDO RECURRENTE del semáforo de riesgo de la RC (F5-E4): recorre las órdenes con RC activa y
   * actualiza su estado de riesgo (incl. la regla "EnRiesgo nace ANTES de programar"). Lo programa
   * el bootstrap con `schedule` (pg-boss); el handler vive en `comun/jobs/riesgo-rc.ts`.
   */
  barridoRiesgoRc: 'rc-barrido-riesgo',
  /**
   * REFRESCO de las VISTAS MATERIALIZADAS de KPIs (F7-E3, plan §11): recalcula los tableros
   * directivos (entregas a tiempo, lead time, cuellos, desempeño, calidad, WIP) SIN que la captura
   * espere. Lo programa el bootstrap con `schedule` (cron) y lo dispara on-demand el endpoint
   * `POST /api/indicadores/refrescar`. El handler vive en `comun/jobs/refrescar-kpis.ts`.
   */
  refrescarKpis: 'kpi-refrescar',
  /**
   * SEGUNDO RESPALDO de la base, cifrado y subido a R2 (V1-E6a, plan §2.2 "respaldo doble"): el único
   * respaldo PROPIO del sistema. Los diarios de Railway ya cubren el día a día; éste cubre el caso en
   * que el problema SEA Railway (cuenta suspendida, servicio borrado, mudanza de proveedor), y por eso
   * corre MENSUAL. Lo programa el bootstrap con `schedule` (cron configurable) y el handler vive en
   * `comun/jobs/respaldo-bd.ts`.
   */
  respaldoBd: 'respaldo-bd',
} as const;

/** Nombre válido de cola de jobs. */
export type NombreColaJob = (typeof COLAS_JOBS)[keyof typeof COLAS_JOBS];

/**
 * Opciones por cola aplicadas al crearla. El default de `expireInSeconds` de pg-boss son 15 minutos:
 * pasado ese rato marca el job como expirado y lo REINTENTA **sin detener al que sigue corriendo**.
 * Para un respaldo de una base grande eso significa dos corridas solapadas; por eso su cola declara
 * una ventana acorde (la misma que usa el propio respaldo, `ventanaCorridaMinutos`, y que su
 * `schedule` vuelve a pasar a nivel de job).
 */
const OPCIONES_POR_COLA: Partial<Record<NombreColaJob, { expireInSeconds: number }>> = {
  // La clave es el NOMBRE de la cola, no el alias del objeto.
  [COLAS_JOBS.respaldoBd]: { expireInSeconds: (180 + 60) * 60 },
};

/** Carga del job de recálculo de la RC de una orden (lo mínimo: el consumidor relee la BD, E4). */
export interface PayloadRecalcularRuta {
  /** Orden cuya ruta hay que (re)calcular. */
  idOrden: number;
  /** Empresa dueña de la orden (A9) — para que el handler cargue el calendario correcto. */
  idEmpresa: number;
  /** Motivo del recálculo (traza): 'generar' (primera programación) o 'ajustar' (edición de ruta). */
  motivo: 'generar' | 'ajustar';
}

/**
 * Construye la `singletonKey` de SERIALIZACIÓN para un recurso dado. PURO (sin pg-boss): por eso es
 * testeable sin BD. La clave combina la cola y el id del recurso: dos jobs de la MISMA cola sobre el
 * MISMO recurso comparten clave → pg-boss los serializa/dedup. Recursos distintos (otra orden) o
 * colas distintas NO se bloquean entre sí.
 *
 * @param cola      nombre de la cola del job.
 * @param idRecurso identificador del recurso a serializar (p. ej. la orden).
 */
export function claveSerializacion(cola: NombreColaJob, idRecurso: number): string {
  return `${cola}:${String(idRecurso)}`;
}

/** Instancia singleton del motor de jobs (null si está inactivo o aún no arrancó). */
let boss: PgBoss | null = null;

/** ¿El motor de jobs está activo por configuración? Inactivo si `JOBS_ACTIVOS === 'false'`. */
export function jobsActivos(): boolean {
  return process.env.JOBS_ACTIVOS !== 'false';
}

/**
 * Inyecta una instancia de pg-boss ya arrancada (lo usan el bootstrap del servidor y los tests de
 * integración). Pasar `null` la limpia. NO arranca/cierra nada: solo fija el singleton que usará
 * `encolarJob` / `registrarHandler`.
 */
export function fijarMotorJobs(instancia: PgBoss | null): void {
  boss = instancia;
}

/** Devuelve la instancia activa de pg-boss (o `null` si el motor está inactivo/sin arrancar). */
export function motorJobs(): PgBoss | null {
  return boss;
}

/**
 * Arranca el motor de jobs (pg-boss sobre `DATABASE_URL`) y crea las colas declaradas. Idempotente
 * (si ya arrancó, no hace nada). NO-OP si el motor está inactivo (tests/CI) o falta `DATABASE_URL`.
 * Best-effort: si pg-boss no arranca, se registra y la app sigue (los productores quedan en no-op;
 * el recálculo se puede re-disparar luego). Lo llama el bootstrap del servidor.
 *
 * @param registrarError hook para logear (por defecto `console.error`); el servidor inyecta el suyo.
 */
export async function iniciarMotorJobs(
  registrarError: (mensaje: string, error: unknown) => void = (msg, err) => {
    console.error(msg, err);
  },
): Promise<void> {
  if (!jobsActivos()) {
    return; // tests/CI: el motor se deja inactivo a propósito (no hay pg-boss vivo).
  }
  if (boss !== null) {
    return; // ya arrancó.
  }
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    registrarError('Motor de jobs: falta DATABASE_URL; pg-boss no arranca.', undefined);
    return;
  }
  try {
    const instancia = new PgBoss({ connectionString: url });
    instancia.on('error', (error: unknown) => {
      registrarError('pg-boss (jobs) reportó un error (best-effort):', error);
    });
    await instancia.start();
    for (const cola of Object.values(COLAS_JOBS)) {
      // Opciones POR COLA (heredadas por sus jobs salvo que el productor las pise). Hoy sólo el
      // respaldo necesita una: su corrida puede durar horas y el default de pg-boss (15 min de
      // `expireInSeconds`) la daría por expirada y la reintentaría ENCIMA de la que sigue viva.
      const opciones = OPCIONES_POR_COLA[cola];
      await (opciones === undefined
        ? instancia.createQueue(cola)
        : instancia.createQueue(cola, opciones));
    }
    boss = instancia;
  } catch (error) {
    registrarError('No se pudo iniciar el motor de jobs (la app sigue):', error);
    boss = null;
  }
}

/** Cierra el motor de jobs de forma ordenada (apagado del servidor). Idempotente. */
export async function detenerMotorJobs(): Promise<void> {
  if (boss !== null) {
    const instancia = boss;
    boss = null;
    await instancia.stop({ graceful: true });
  }
}

/**
 * ENCOLA un job en una cola, SERIALIZADO por su recurso (`singletonKey`): si ya hay un job pendiente
 * para el mismo recurso en esa cola, pg-boss lo DESCARTA (dedup) — varios disparos seguidos colapsan
 * en uno. NO-OP si el motor está inactivo/sin arrancar (devuelve `null`): el llamador NO debe esperar
 * a este resultado para responder al usuario (la captura nunca bloquea por el job, §11).
 *
 * @param cola       cola destino.
 * @param idRecurso  id del recurso a serializar (alimenta la `singletonKey`).
 * @param payload    carga del job (lo mínimo; el handler relee la BD).
 * @param opciones   reintentos/retención passthrough a pg-boss (defaults sensatos abajo).
 * @returns el id del job encolado, `null` si se dedupó o si el motor está inactivo.
 */
export async function encolarJob<T extends object>(
  cola: NombreColaJob,
  idRecurso: number,
  payload: T,
  opciones?: { reintentos?: number; reintentoEsperaSeg?: number; retenerSeg?: number },
): Promise<string | null> {
  if (boss === null) {
    return null; // motor inactivo o sin arrancar: el job se puede re-disparar luego.
  }
  return boss.send(cola, payload, {
    singletonKey: claveSerializacion(cola, idRecurso),
    retryLimit: opciones?.reintentos ?? 3,
    retryDelay: opciones?.reintentoEsperaSeg ?? 30,
    retryBackoff: true,
    retentionSeconds: opciones?.retenerSeg ?? 60 * 60 * 24, // 24 h.
  });
}

/**
 * Registra un HANDLER (worker) que procesa los jobs de una cola UNO A LA VEZ (`localConcurrency: 1`
 * + `batchSize: 1`, coherente con la serialización por orden). NO-OP si el motor está inactivo. El
 * handler debe ser idempotente (un mismo recálculo se puede repetir tras un reintento). Lo usará E4
 * para montar el worker del CPM.
 *
 * @param cola     cola a consumir.
 * @param manejar  función que procesa un job (su `data` es el payload encolado).
 */
export async function registrarHandler<T extends object>(
  cola: NombreColaJob,
  manejar: (payload: T) => Promise<void>,
): Promise<void> {
  if (boss === null) {
    return; // motor inactivo: nada que consumir.
  }
  await boss.work<T>(cola, { localConcurrency: 1, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await manejar(job.data);
    }
  });
}
