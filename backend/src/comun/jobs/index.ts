/**
 * MOTOR de JOBS en segundo plano sobre pg-boss (F5-E3 — ADR-0012). Es la infraestructura COMÚN
 * para tareas asíncronas durables: el CPM de la Ruta Crítica (E4), el auto-avance por eventos (E6)
 * y cualquier trabajo futuro que no deba bloquear la respuesta HTTP.
 *
 * Decisiones de diseño (ADR-0012):
 *  • Una sola instancia de pg-boss para TODA la app, sobre el MISMO Postgres (`DATABASE_URL`) —
 *    no se introduce otro broker; misma decisión que la cola de eventos (ADR-0011).
 *  • SERIALIZACIÓN POR ORDEN vía `singletonKey` — Y LA POLÍTICA DE LA COLA, QUE ES LO QUE LA HACE
 *    REAL. ⚠️ `singletonKey` POR SÍ SOLO NO RESTRINGE NADA: en una cola con la política por defecto
 *    (`standard`) pg-boss GUARDA la clave y acepta todos los `send` que le manden — los índices
 *    únicos sobre `(name, singleton_key)` sólo existen para las políticas `short` / `singleton` /
 *    `stately` / `exclusive` / `key_strict_fifo`. Por eso cada cola DECLARA su política en
 *    {@link POLITICA_POR_COLA} y `encolarJob` sólo acepta —por tipo— las colas que declaran una que
 *    de verdad serializa. Las que se usan con `singletonKey` van en **`stately`**: pg-boss permite a
 *    lo sumo UN job por ESTADO y clave entre `created`/`retry`/`active` (índice `job_i3`), o sea
 *    ≤1 corriendo + ≤1 esperando. Consecuencias exactas, medidas contra pg-boss 12.20:
 *      – varios disparos seguidos sobre la misma orden mientras NADA corre → colapsan en UNO solo
 *        (el 2º y el 3er `send` devuelven `null`);
 *      – un disparo que llega MIENTRAS se recalcula esa orden → SÍ se encola y corre DESPUÉS, así
 *        que el cambio que lo provocó nunca se pierde (el handler relee la BD, gana el último);
 *      – órdenes distintas no se estorban (claves distintas).
 *    NO se usa `exclusive` —que sería «≤1 job entre `created`/`retry`/`active`, punto»— justamente
 *    porque descartaría ese disparo que llega con un recálculo ya activo: el evento se perdería y la
 *    ruta quedaría con fechas viejas hasta el siguiente evento.
 *  • LA POLÍTICA NO SE PUEDE CAMBIAR EN CALIENTE (pg-boss 12): `createQueue` sobre una cola que ya
 *    existe hace `ON CONFLICT DO NOTHING` —ignora la opción EN SILENCIO— y `updateQueue` lanza
 *    «queue policy cannot be changed after creation». La única vía es borrar y recrear la cola, y eso
 *    tira los jobs que tuviera encolados. Lo hace {@link conciliarPoliticasColas} al arrancar, sólo
 *    cuando lo guardado NO coincide con lo declarado, y dejándolo dicho en el log.
 *  • GUARDA POR ENTORNO: el worker arranca SOLO si `JOBS_ACTIVOS` no está en "false". En tests/CI se
 *    deja INACTIVO (no hay pg-boss vivo). Sin BD son testeables la CONSTRUCCIÓN de la singletonKey,
 *    la POLÍTICA que declara cada cola (y que pg-boss la respalde con su índice único, leyéndolo de
 *    `getConstructionPlans()`) y la conciliación; lo que NO —que dos `send` con la misma clave den id
 *    y `null`— se prueba en integración/Railway. Con el motor inactivo, `encolarJob` es un no-op
 *    silencioso que devuelve `null` (nadie se rompe).
 *
 * En E3 el handler del CPM NO se implementa (es E4): aquí se registra el NOMBRE de la cola y se deja
 * que `generarRutaOrden` ENCOLE el recálculo. El worker que consume esa cola lo monta E4.
 */
import { PgBoss } from 'pg-boss';

import { ventanaCorridaMinutos } from '../respaldo/pg-dump.js';

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
 * Políticas de cola que admite pg-boss 12 (el mismo juego que exporta como `policies`). Sólo
 * `standard` NO restringe nada; las otras cinco crean índices únicos sobre `(name, singleton_key)`.
 */
export type PoliticaCola =
  | 'standard'
  | 'short'
  | 'singleton'
  | 'stately'
  | 'exclusive'
  | 'key_strict_fifo';

/**
 * POLÍTICA DECLARADA DE CADA COLA — la pieza que hace REAL la serialización por `singletonKey`.
 * Es exhaustiva sobre {@link COLAS_JOBS} a propósito (`Record<NombreColaJob, …>`): una cola nueva
 * DE ESTE MOTOR no compila hasta que su autor decida, a la vista, si serializa o no. (Ojo con el
 * alcance: `comun/cola-eventos.ts` crea su propia cola `eventos-dominio` sobre OTRA instancia de
 * pg-boss y NO pasa por aquí. No usa `singletonKey`, así que hoy no le falta nada; pero esta tabla
 * no la cubre, y si algún día se le pusiera clave habría que darle política a mano.)
 *
 *  • `stately` en las colas que se encolan con `encolarJob` (o sea, con `singletonKey`): ≤1 job por
 *    estado y clave entre `created`/`retry`/`active` → ≤1 corriendo + ≤1 esperando. Ver la cabecera.
 *  • `standard` en las colas que NO usan `singletonKey` y viven de un `schedule` (cron). Ahí la
 *    protección contra duplicados NO es la política de ESTA cola, y conviene saber dónde está de
 *    verdad: el timekeeper de pg-boss no manda el cron directo, lo mete primero en su cola INTERNA
 *    `__pgboss__send-it` con `singletonKey` + `singletonSeconds: 60`, y ahí sí lo dedupa el índice
 *    de throttle `job_i4` (que actúa con cualquier política). El job que acaba llegando a NUESTRA
 *    cola sale de ese despacho y viaja SIN `singletonKey`. Para el respaldo, además, quien cierra el
 *    solape es `expireInSeconds` + la guarda de antigüedad de su barrido (razonado en
 *    `respaldo-bd.ts`, donde se programa).
 *
 * ⚠️ CONSECUENCIA EN `kpi-refrescar`, la única cola `stately` que ADEMÁS tiene cron: como los envíos
 * del cron llegan sin `singletonKey`, comparten entre ellos la clave vacía y `stately` LOS DEDUPA
 * TAMBIÉN — si un refresco sigue esperando, el siguiente tic del cron no encola otro. Es deseable
 * (antes se apilaban) pero no es lo que sugiere la frase «la política aplica a las colas que se
 * encolan con singletonKey»: aquí aplica a las dos vías. Las dos claves —la vacía del cron y
 * `kpi-refrescar:0` del botón— son DISTINTAS, así que no se estorban entre sí.
 *
 * ⚠️ Cambiar un valor de aquí NO basta si la cola YA existe en la base: pg-boss no deja cambiar la
 * política en caliente. Lo resuelve {@link conciliarPoliticasColas} al arrancar (recrea la cola).
 */
export const POLITICA_POR_COLA = {
  [COLAS_JOBS.recalcularRutaOrden]: 'stately',
  [COLAS_JOBS.refrescarKpis]: 'stately',
  [COLAS_JOBS.barridoRiesgoRc]: 'standard',
  [COLAS_JOBS.respaldoBd]: 'standard',
} as const satisfies Record<NombreColaJob, PoliticaCola>;

/**
 * Colas que SÍ serializan por `singletonKey` — las únicas que {@link encolarJob} acepta. Sale de
 * {@link POLITICA_POR_COLA}, no de una lista tecleada aparte: si alguien pone una de estas colas en
 * `standard`, sus llamadas a `encolarJob` DEJAN DE COMPILAR en vez de volverse decorativas.
 */
export type ColaSerializada = {
  [K in NombreColaJob]: (typeof POLITICA_POR_COLA)[K] extends 'standard' ? never : K;
}[NombreColaJob];

/**
 * Opciones por cola aplicadas al crearla. El default de `expireInSeconds` de pg-boss son 15 minutos:
 * pasado ese rato marca el job como expirado y lo REINTENTA **sin detener al que sigue corriendo**.
 * Para un respaldo de una base grande eso significa dos corridas solapadas; por eso su cola declara
 * una ventana acorde.
 *
 * El valor NO se teclea: sale de {@link ventanaCorridaMinutos}, la MISMA función que usan el
 * `schedule` del respaldo y el barrido de huérfanas. Tecleado, subir `RESPALDO_TIMEOUT_MIN` volvería
 * a separar los números — justo la deriva que ese arreglo vino a eliminar. Se importa de
 * `respaldo/pg-dump.js` (módulo ligero) y no de `respaldo/config.js`, que arrastraría el servicio de
 * archivos —y con él el SDK de AWS— a este bootstrap genérico.
 *
 * (Hoy este valor es el de RESERVA: pg-boss da precedencia al del job — `COALESCE("expireInSeconds",
 * q.expire_seconds)` — y el `schedule` del respaldo pasa el suyo. Cubre a cualquier otro productor.)
 */
const OPCIONES_POR_COLA: Partial<Record<NombreColaJob, { expireInSeconds: number }>> = {
  // La clave es el NOMBRE de la cola, no el alias del objeto.
  [COLAS_JOBS.respaldoBd]: { expireInSeconds: ventanaCorridaMinutos() * 60 },
};

/**
 * Opciones COMPLETAS con las que se crea una cola: su política declarada ({@link POLITICA_POR_COLA})
 * más los extras de {@link OPCIONES_POR_COLA}. Punto ÚNICO — lo usan tanto la creación inicial como
 * la recreación de {@link conciliarPoliticasColas}, para que las dos no puedan divergir.
 */
export function opcionesDeCola(cola: NombreColaJob): {
  policy: PoliticaCola;
  expireInSeconds?: number;
} {
  return { policy: POLITICA_POR_COLA[cola], ...OPCIONES_POR_COLA[cola] };
}

/**
 * Lo MÍNIMO de pg-boss que necesita {@link conciliarPoliticasColas}. Existe para poder probar la
 * conciliación SIN base de datos (una instancia de `PgBoss` lo cumple tal cual).
 */
export interface MotorColas {
  createQueue(
    nombre: string,
    opciones?: { policy?: string; expireInSeconds?: number },
  ): Promise<void>;
  getQueue(nombre: string): Promise<{ policy?: string } | null>;
  deleteQueue(nombre: string): Promise<void>;
}

/**
 * Deja cada cola con la POLÍTICA que declara {@link POLITICA_POR_COLA}, incluso si ya existía en la
 * base creada con otra. Es imprescindible: `createQueue` sobre una cola existente ignora la opción
 * EN SILENCIO (`ON CONFLICT DO NOTHING`) y `updateQueue` lanza a propósito, así que sin esto un
 * cambio de política sería código muerto en cualquier base que ya haya arrancado — exactamente el
 * defecto que este arreglo vino a cerrar, una vuelta más arriba.
 *
 * ⚠️ Recrear la cola BORRA los jobs que tuviera encolados (y su `schedule`, por FK en cascada). Se
 * asume a conciencia: (1) sólo pasa cuando lo guardado NO coincide con lo declarado, o sea UNA vez
 * por cambio de política y nunca más; (2) los jobs de estas colas son recálculos idempotentes que se
 * vuelven a disparar solos con el siguiente evento —no son el hecho de negocio, que ya está
 * comiteado—; y (3) el `schedule` lo re-registra el arranque justo después (`servidor.ts` programa
 * cron y handlers DESPUÉS de `iniciarMotorJobs`).
 *
 * NUNCA lanza: cada cola va en su propio try/catch. Si tumbara a `iniciarMotorJobs`, un tropiezo de
 * conciliación dejaría al sistema SIN motor de jobs — mucho peor que la política mal puesta.
 *
 * @param motor          instancia de pg-boss ya arrancada.
 * @param registrarError hook para logear; se usa también para lo que SÍ pasó (recrear una cola es un
 *                       hecho operativo que debe verse en el log, no un silencio).
 */
export async function conciliarPoliticasColas(
  motor: MotorColas,
  registrarError: (mensaje: string, error: unknown) => void,
): Promise<void> {
  for (const cola of Object.values(COLAS_JOBS)) {
    const esperada: PoliticaCola = POLITICA_POR_COLA[cola];
    try {
      const guardada = (await motor.getQueue(cola))?.policy;
      if (guardada === esperada) {
        continue; // ya coincide (caso normal: base nueva, o arranques posteriores al cambio).
      }
      registrarError(
        `Motor de jobs: la cola "${cola}" está guardada con política "${guardada ?? '(ninguna)'}" ` +
          `y debe ser "${esperada}". pg-boss no permite cambiarla en caliente, así que se RECREA: ` +
          'los jobs que tuviera encolados se PIERDEN (son recálculos idempotentes; el siguiente ' +
          'evento los vuelve a disparar).',
        undefined,
      );
      await motor.deleteQueue(cola);
      await motor.createQueue(cola, opcionesDeCola(cola));
      const verificada = (await motor.getQueue(cola))?.policy;
      if (verificada !== esperada) {
        registrarError(
          `Motor de jobs: la cola "${cola}" SIGUE con política "${verificada ?? '(ninguna)'}" tras ` +
            'recrearla. La serialización por singletonKey NO está activa en esa cola: varios ' +
            'disparos sobre el mismo recurso se encolarán por separado.',
          undefined,
        );
      }
    } catch (error) {
      registrarError(
        `Motor de jobs: no se pudo conciliar la política de la cola "${cola}" (se sigue con las ` +
          'demás; la serialización de ESA cola puede no estar activa).',
        error,
      );
    }
  }
}

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
 * MISMO recurso comparten clave; recursos distintos (otra orden) o colas distintas NO. ⚠️ La clave
 * SOLA no serializa nada — quien lo hace es la política de la cola ({@link POLITICA_POR_COLA}); esto
 * sólo la alimenta.
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
      // Opciones POR COLA: su POLÍTICA (lo que hace real la serialización por `singletonKey`) más
      // los extras que declare. Hoy sólo el respaldo necesita un extra: su corrida puede durar horas
      // y el default de pg-boss (15 min de `expireInSeconds`) la daría por expirada y la reintentaría
      // ENCIMA de la que sigue viva.
      await instancia.createQueue(cola, opcionesDeCola(cola));
    }
    // Y AQUÍ ESTÁ EL PUNTO FINO: la línea de arriba NO cambia la política de una cola que ya existía
    // —`createQueue` la ignora en silencio—, así que sin esto el arreglo sería decorativo en toda
    // base ya arrancada (Railway `prueba` incluido). Nunca lanza.
    await conciliarPoliticasColas(instancia, registrarError);
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
 * ENCOLA un job SERIALIZADO por su recurso (`singletonKey`). Sólo acepta —por tipo— colas de
 * {@link ColaSerializada}, es decir las que declaran una política que de verdad serializa: en una
 * cola `standard` la clave se guardaría sin restringir nada y esto sería un cinturón que no sujeta.
 *
 * Con la política `stately` que declaran hoy: si ya hay un job ESPERANDO para el mismo recurso, el
 * `send` se DESCARTA y devuelve `null` (los disparos seguidos colapsan en uno); si el que hay está
 * CORRIENDO, el nuevo SÍ se encola y corre después (el cambio que lo provocó no se pierde).
 *
 * NO-OP si el motor está inactivo/sin arrancar (devuelve `null`): el llamador NO debe esperar a este
 * resultado para responder al usuario (la captura nunca bloquea por el job, §11).
 *
 * @param cola       cola destino (debe declarar una política que serialice).
 * @param idRecurso  id del recurso a serializar (alimenta la `singletonKey`).
 * @param payload    carga del job (lo mínimo; el handler relee la BD).
 * @param opciones   reintentos/retención passthrough a pg-boss (defaults sensatos abajo).
 * @returns el id del job encolado, `null` si se dedupó o si el motor está inactivo.
 */
export async function encolarJob<T extends object>(
  cola: ColaSerializada,
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
 * Registra un HANDLER (worker) que procesa los jobs de una cola UNO A LA VEZ **en ESTE proceso**
 * (`localConcurrency: 1` + `batchSize: 1`). Ojo con el alcance: eso es una config LOCAL, no una
 * garantía del motor — si algún día corrieran dos instancias del backend, cada una tendría su
 * worker. Lo que sí vale entre instancias es la política de la cola: con `stately`, la base impide
 * que dos jobs del MISMO recurso estén activos a la vez, corran donde corran. NO-OP si el motor está
 * inactivo. El handler debe ser idempotente (un mismo recálculo se puede repetir tras un reintento).
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
