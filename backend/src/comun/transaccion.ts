/**
 * Transacciones componibles sobre Prisma (MEJORAS A2).
 *
 * Regla del sistema: toda operación multi-tabla ocurre en UNA transacción
 * (PLANMAESTRO §9.2). En el sistema viejo no había transacciones: un corte de
 * luz a media captura dejaba órdenes a medias y descuadres de inventario.
 *
 * Patrón de TODOS los servicios de dominio:
 *
 * ```ts
 * export async function crearAlgo(sesion: SesionUsuario, entrada: X, bd?: ContextoBd) {
 *   return enTransaccion(async (tx) => {
 *     // ...todas las escrituras y la bitácora van sobre `tx`...
 *   }, bd);
 * }
 * ```
 *
 * La composición (A2) sale gratis: si el llamador ya está en una transacción,
 * pasa su `tx` en `bd` y el servicio se UNE a ella (no abre otra); si no, el
 * servicio abre la suya contra el cliente indicado (o el singleton). Así el
 * futuro "recibo de maquila" (PLANMAESTRO §5: WIP + IPT + EsMa + RC en una
 * operación) podrá invocar varios servicios dentro de una sola transacción.
 */
import { prisma, type Prisma, type PrismaClient } from '../datos/index.js';

/**
 * Cliente de Prisma DENTRO de una transacción interactiva. Es el tipo que
 * reciben todos los helpers transaccionales (`siguienteFolio`,
 * `registrarBitacora`, …): aceptar `Tx` y no `PrismaClient` obliga, por tipos,
 * a usarlos dentro de una transacción.
 */
export type Tx = Prisma.TransactionClient;

/**
 * Lo que devuelve {@link clienteLectura}: un cliente que sirve para CONSULTAR, esté o no dentro de
 * una transacción. Los lectores puros lo piden en vez de `Tx` para no obligar a abrir una
 * transacción sólo para leer.
 */
export type ClienteLectura = Tx | PrismaClient;

/**
 * Contexto de base de datos que aceptan los servicios de dominio como último
 * parámetro (opcional). Permite componer transacciones y apuntar los tests de
 * integración al Postgres efímero sin tocar el singleton.
 */
export interface ContextoBd {
  /**
   * Transacción ya abierta por el llamador: el servicio se une a ella y NO
   * abre una nueva (composición A2). Tiene prioridad sobre `cliente`.
   */
  tx?: Tx;
  /**
   * Cliente contra el que abrir la transacción cuando no se pasa `tx`.
   * Por omisión se usa el singleton de `src/datos`; los tests de integración
   * pasan aquí su cliente del contenedor (testcontainers, PLANMAESTRO §9.2).
   */
  cliente?: PrismaClient;
}

/** Opciones passthrough a `prisma.$transaction` cuando se abre transacción nueva. */
export interface OpcionesTransaccion {
  /** Máximo de espera para adquirir conexión (ms). */
  maxWait?: number;
  /** Tiempo máximo de la transacción (ms). */
  timeout?: number;
  /** Nivel de aislamiento; el default de Postgres (ReadCommitted) basta para lo común. */
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Ejecuta `fn` dentro de una transacción.
 *
 * - Con `bd.tx`: ejecuta directo sobre esa transacción (ya estamos dentro de
 *   una; abrir otra anidada no existe en Prisma y rompería la atomicidad
 *   percibida por el llamador).
 * - Sin `bd.tx`: abre una transacción interactiva sobre `bd.cliente` (o el
 *   singleton) y la commitea/revierte completa: si `fn` lanza, NADA persiste.
 *
 * @returns lo que devuelva `fn`.
 */
export async function enTransaccion<T>(
  fn: (tx: Tx) => Promise<T>,
  bd?: ContextoBd,
  opciones?: OpcionesTransaccion,
): Promise<T> {
  if (bd?.tx) {
    return fn(bd.tx);
  }
  const cliente = bd?.cliente ?? prisma;
  return cliente.$transaction(fn, opciones);
}

/**
 * Cliente para LECTURAS sueltas (listados, consultas) que no requieren abrir
 * transacción: la transacción del llamador si existe, si no su cliente, si no
 * el singleton. Las escrituras NUNCA usan esto directo — van por `enTransaccion`.
 */
export function clienteLectura(bd?: ContextoBd): ClienteLectura {
  return bd?.tx ?? bd?.cliente ?? prisma;
}
