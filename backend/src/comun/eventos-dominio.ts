/**
 * Contrato VERSIONADO de los eventos de dominio que se publican por el patrón OUTBOX
 * transaccional (F4-E3 — ADR-0011). A diferencia del emitter in-process best-effort de
 * `comun/eventos.ts` (gancho RC de F3, en memoria), estos eventos se PERSISTEN en la tabla
 * `EventoOutbox` DENTRO de la transacción del hecho de negocio: el evento NUNCA se pierde aunque
 * el proceso muera tras el commit. El relay (`comun/cola-eventos.ts`) los publica a pg-boss.
 *
 * Reglas (ADR-0011):
 *  • La fila outbox se escribe con `registrarEventoOutbox(tx, …)` en la MISMA `tx` del negocio
 *    (atómico: o quedan el hecho Y el evento, o ninguno).
 *  • El consumidor de negocio (RC/MRP) llega en F5: aquí SOLO se publica y queda registrado.
 *  • El payload lleva lo MÍNIMO para que un consumidor reaccione (ids + material); el consumidor
 *    relee de la BD lo que necesite. `version` permite evolucionar el contrato sin romper.
 */
import type { Prisma } from '../datos/index.js';

import type { Tx } from './transaccion.js';

/** Nombres de los eventos de dominio publicados por outbox (F4-E3+). */
export const EVENTOS_OUTBOX = {
  /** Material (tela/avío) recibido contra una OC: dispara MRP/RC en F5 (ADR-0011). */
  materialRecibido: 'material-recibido',
} as const;

/** Nombre válido de evento de outbox. */
export type NombreEventoOutbox = (typeof EVENTOS_OUTBOX)[keyof typeof EVENTOS_OUTBOX];

/** Versión actual del contrato del evento `material-recibido`. */
export const VERSION_MATERIAL_RECIBIDO = 1;

/**
 * Un material recibido en un renglón de recepción. `tipo`: `'tela'` (con `idLote` del lote creado),
 * `'avio'` (sin lote) o `'libre'` (línea no catalogada — informativa, no inventaría).
 *
 * NOTA (M3 — reviewer F4-E3): el evento NO lleva la cantidad recibida. Mezclar unidades heterogéneas
 * (metros de tela + piezas de avío) en un escalar es engañoso y nadie lo usaría para cálculo; el
 * consumidor (F5) relee de la BD la cantidad/costo por renglón si los necesita.
 */
export type MaterialRecibido = {
  tipo: 'tela' | 'avio' | 'libre';
  /** Id del material de catálogo (tela/avío) o null para líneas libres. */
  id: number | null;
  /** Lote creado para la tela (D5) o null. */
  idLote: number | null;
  /** Renglón de OC contra el que se recibió (R7). */
  idOrdenCompraLinea: number;
  /** Orden de PRODUCCIÓN ligada al renglón de OC (R7), o null. */
  idOrden: number | null;
};

/**
 * Carga del evento `material-recibido` (contrato v1, ADR-0011). Lo MÍNIMO para que el consumidor
 * (MRP/RC de F5) reaccione: contra qué OC/recepción entró qué material y a qué almacén. El consumidor
 * relee el detalle (cantidades/costos) de la BD si lo necesita.
 */
export type EventoMaterialRecibido = {
  /** Empresa (A9). */
  idEmpresa: number;
  /** Orden de COMPRA contra la que se recibió. */
  idOrdenCompra: number;
  /** Recepción que generó el evento. */
  idRecepcion: number;
  /** Folio de la recepción (informativo). */
  folioRecepcion: number;
  /** Material REPRESENTATIVO (el primer renglón) — para consumidores simples. Siempre presente. */
  material: MaterialRecibido;
  /** TODOS los materiales recibidos en la recepción (un renglón por material; no se pierde ninguno). */
  materiales: MaterialRecibido[];
  /** Almacén destino donde entró el material. */
  idAlmacen: number;
  /** Fecha de la recepción (YYYY-MM-DD). */
  fecha: string;
};

/**
 * Inserta una fila en el OUTBOX (`EventoOutbox`) DENTRO de la transacción del hecho de negocio
 * (ADR-0011). NO publica nada a la cola: eso lo hace el relay tras el commit. Exige `tx` por tipo
 * para garantizar que la escritura del evento sea atómica con el negocio.
 *
 * @param tx       transacción activa del hecho de negocio.
 * @param evento   nombre del evento (de {@link EVENTOS_OUTBOX}).
 * @param version  versión del contrato del payload.
 * @param idEmpresa empresa dueña del hecho (A9).
 * @param payload  carga JSON del evento (lo mínimo para reaccionar).
 * @returns el id de la fila outbox creada (para que el relay la publique tras el commit).
 */
export async function registrarEventoOutbox(
  tx: Tx,
  evento: NombreEventoOutbox,
  version: number,
  idEmpresa: number,
  payload: Prisma.InputJsonValue,
): Promise<number> {
  const fila = await tx.eventoOutbox.create({
    data: { tipo: evento, version, idEmpresa, payload },
    select: { id: true },
  });
  return fila.id;
}
