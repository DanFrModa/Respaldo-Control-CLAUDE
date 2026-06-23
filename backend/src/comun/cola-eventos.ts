/**
 * RELAY del OUTBOX a la cola pg-boss (F4-E3 — ADR-0011: patrón outbox transaccional + pg-boss).
 *
 * El dominio escribe el evento en la tabla `EventoOutbox` DENTRO de la transacción del hecho de
 * negocio (atómico — `comun/eventos-dominio.ts`). Este módulo lo PUBLICA a una cola durable
 * (pg-boss, sobre el MISMO Postgres del sistema vía `DATABASE_URL`) y marca `publicadoEn`. Dos
 * disparadores publican:
 *  • `publicarPendientes()` — best-effort tras el commit de la recepción (latencia mínima).
 *  • un BARRIDO periódico — reintenta las filas que quedaron sin publicar (durabilidad: si el
 *    proceso murió entre el commit y el publish, el barrido las recupera).
 *
 * GUARDA POR ENTORNO: el worker pg-boss arranca SOLO si `EVENTOS_COLA_ACTIVA` no está en "false".
 * En tests/CI se deja INACTIVO (no hay pg-boss vivo) — lo crítico y testeable es la ESCRITURA
 * atómica del outbox, no el transporte. Con la cola inactiva, `publicarPendientes()` es un no-op
 * silencioso (las filas quedan en el outbox; nadie las pierde).
 *
 * El CONSUMIDOR de negocio (MRP/RC) es de F5: aquí SOLO se publica a la cola y se registra. No se
 * suscribe ningún handler de negocio.
 */
import { PgBoss } from 'pg-boss';

import { prisma } from '../datos/index.js';

/** Nombre de la cola pg-boss donde se publican los eventos de dominio (ADR-0011). */
export const COLA_EVENTOS_DOMINIO = 'eventos-dominio';

/** Cuántos ms entre barridos del outbox (reintento de no publicados). Default 30 s. */
const INTERVALO_BARRIDO_MS = Number(process.env.EVENTOS_BARRIDO_MS ?? 30_000);

/** Cuántas filas outbox publica como máximo cada disparo (acota la carga). */
const LOTE_PUBLICACION = 200;

/** Instancia singleton de pg-boss (null si la cola está inactiva o aún no arrancó). */
let boss: PgBoss | null = null;
/** Handle del barrido periódico (para cerrarlo limpio). */
let temporizadorBarrido: NodeJS.Timeout | null = null;

/** ¿La cola está activa por configuración? Inactiva si `EVENTOS_COLA_ACTIVA === 'false'`. */
export function colaEventosActiva(): boolean {
  return process.env.EVENTOS_COLA_ACTIVA !== 'false';
}

/**
 * Arranca pg-boss sobre el Postgres del sistema y el barrido periódico del outbox. Idempotente
 * (si ya arrancó, no hace nada). NO-OP si la cola está inactiva (tests/CI) o falta `DATABASE_URL`.
 * Best-effort: si pg-boss no arranca, se registra y la app sigue (las filas quedan en el outbox y
 * el barrido reintentará cuando la cola esté viva).
 *
 * @param registrarError  hook para logear (por defecto `console.error`); el servidor inyecta el suyo.
 */
export async function iniciarColaEventos(
  registrarError: (mensaje: string, error: unknown) => void = (msg, err) => {
    console.error(msg, err);
  },
): Promise<void> {
  if (!colaEventosActiva()) {
    return; // tests/CI: la cola se deja inactiva a propósito (no hay pg-boss vivo).
  }
  if (boss !== null) {
    return; // ya arrancó.
  }
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    registrarError('Cola de eventos: falta DATABASE_URL; pg-boss no arranca.', undefined);
    return;
  }
  try {
    const instancia = new PgBoss({ connectionString: url });
    instancia.on('error', (error: unknown) => {
      registrarError('pg-boss reportó un error (best-effort):', error);
    });
    await instancia.start();
    await instancia.createQueue(COLA_EVENTOS_DOMINIO);
    boss = instancia;
    // Barrido periódico: recupera filas que el publish best-effort no alcanzó a encolar.
    temporizadorBarrido = setInterval(() => {
      void publicarPendientes(registrarError);
    }, INTERVALO_BARRIDO_MS);
    // No mantener vivo el proceso solo por el barrido (apagado limpio en servidor.ts).
    temporizadorBarrido.unref();
  } catch (error) {
    registrarError('No se pudo iniciar pg-boss (la app sigue; el outbox no se pierde):', error);
    boss = null;
  }
}

/** Cierra pg-boss y el barrido de forma ordenada (apagado del servidor). Idempotente. */
export async function detenerColaEventos(): Promise<void> {
  if (temporizadorBarrido !== null) {
    clearInterval(temporizadorBarrido);
    temporizadorBarrido = null;
  }
  if (boss !== null) {
    const instancia = boss;
    boss = null;
    await instancia.stop({ graceful: true });
  }
}

/**
 * Publica a la cola las filas del outbox NO publicadas (best-effort). Se llama tras el commit de
 * la recepción (latencia mínima) y desde el barrido periódico (durabilidad). NO-OP si pg-boss no
 * está vivo (cola inactiva o aún no arrancó): las filas quedan en el outbox para el próximo intento.
 *
 * Cada fila se publica a {@link COLA_EVENTOS_DOMINIO} con su `tipo`/`version`/`payload`; al
 * encolar OK se marca `publicadoEn`. Si una falla, se incrementa `intentos` y se guarda el `error`
 * (el barrido la reintentará). No abre transacción de negocio: solo toca el outbox.
 *
 * @param registrarError  hook para logear fallos de publicación.
 */
export async function publicarPendientes(
  registrarError: (mensaje: string, error: unknown) => void = (msg, err) => {
    console.error(msg, err);
  },
): Promise<void> {
  if (boss === null) {
    return; // cola inactiva o no arrancada: las filas esperan en el outbox.
  }
  const instancia = boss;
  // Toda la función va dentro de try/catch porque se la llama fire-and-forget (`void
  // publicarPendientes()` desde el barrido y desde `dispararPublicacion`): si la BD parpadea, el
  // propio `findMany` rechazaría y, sin handler, sería un unhandledRejection que tumba el proceso.
  // Aquí NUNCA debe propagar un rechazo: cualquier error (incl. el `findMany`) se loguea y se sale
  // limpio; las filas quedan en el outbox para el próximo barrido.
  try {
    const pendientes = await prisma.eventoOutbox.findMany({
      where: { publicadoEn: null },
      orderBy: { id: 'asc' },
      take: LOTE_PUBLICACION,
    });
    for (const fila of pendientes) {
      try {
        await instancia.send(COLA_EVENTOS_DOMINIO, {
          id: fila.id,
          tipo: fila.tipo,
          version: fila.version,
          idEmpresa: fila.idEmpresa,
          payload: fila.payload,
        });
        await prisma.eventoOutbox.update({
          where: { id: fila.id },
          data: { publicadoEn: new Date() },
        });
      } catch (error) {
        // No bloquea las demás: incrementa el contador y guarda el error; el barrido reintenta.
        await prisma.eventoOutbox
          .update({
            where: { id: fila.id },
            data: { intentos: { increment: 1 }, error: String(error) },
          })
          .catch(() => {
            /* si ni el update del error pega, lo deja para el siguiente barrido */
          });
        registrarError(
          `Cola de eventos: no se pudo publicar la fila outbox ${String(fila.id)}.`,
          error,
        );
      }
    }
  } catch (error) {
    // Falla al leer el outbox (típicamente BD inalcanzable): se loguea y se sale sin lanzar.
    registrarError('Cola de eventos: no se pudieron leer las filas pendientes del outbox.', error);
  }
}

/**
 * Dispara la publicación de pendientes SIN bloquear al llamador (fire-and-forget). Lo usa el
 * dominio TRAS el commit de la recepción: el hecho de negocio ya está consumado; publicar es
 * best-effort (si falla, el barrido lo recupera). NUNCA lanza al llamador.
 */
export function dispararPublicacion(): void {
  void publicarPendientes();
}

/**
 * Forma del MENSAJE que el relay publica a {@link COLA_EVENTOS_DOMINIO} (una fila del outbox). El
 * consumidor de negocio (el auto-avance de la RC, F5-E6) recibe esto: `tipo`/`version` para despachar
 * y `idEmpresa`/`payload` para reaccionar. `payload` es JSON opaco (cada handler lo tipa por `tipo`).
 */
export interface MensajeEventoDominio {
  /** Id de la fila `EventoOutbox` que originó el mensaje (traza). */
  id: number;
  /** Nombre del evento (contrato versionado, p. ej. "recibo-maquila-registrado"). */
  tipo: string;
  /** Versión del contrato del payload. */
  version: number;
  /** Empresa dueña del hecho (A9). */
  idEmpresa: number;
  /** Carga del evento (JSON; el handler la tipa según `tipo`). */
  payload: unknown;
}

/**
 * Registra un CONSUMIDOR de la cola de eventos de dominio (F5-E6): un worker pg-boss sobre la MISMA
 * instancia privada `boss` que usa el relay. Procesa los mensajes UNO A LA VEZ (`localConcurrency: 1`
 * + `batchSize: 1`): el auto-avance re-evalúa el estado de una orden y debe ser ordenado/idempotente.
 *
 * NO-OP si la cola está inactiva o aún no arrancó (tests/CI: `EVENTOS_COLA_ACTIVA=false`): la lógica
 * del auto-avance se prueba invocando el handler directo (sin pg-boss), igual que el CPM de E4. Debe
 * llamarse DESPUÉS de `iniciarColaEventos` (que crea la cola y fija `boss`).
 *
 * El handler NO debe propagar al final: pg-boss reintenta si lanza, y como el auto-avance es
 * idempotente (re-evaluación pura), reintentar es seguro. Aun así, conviene que el handler atrape y
 * loguee para no acumular reintentos por un error de datos.
 *
 * @param manejar  función que procesa un mensaje de evento (su forma es {@link MensajeEventoDominio}).
 */
export async function registrarConsumidorEventos(
  manejar: (mensaje: MensajeEventoDominio) => Promise<void>,
): Promise<void> {
  if (boss === null) {
    return; // cola inactiva o sin arrancar: nada que consumir (la lógica se prueba sin pg-boss).
  }
  await boss.work<MensajeEventoDominio>(
    COLA_EVENTOS_DOMINIO,
    { localConcurrency: 1, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await manejar(job.data);
      }
    },
  );
}
