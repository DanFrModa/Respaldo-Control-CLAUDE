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
  /** El material de una recepción se REVERSÓ: la RC re-evalúa `recepcionTela` (F5-E6, decisión (f)). */
  materialRecibidoCancelado: 'material-recibido-cancelado',
  /** Corte registrado en una orden: la RC re-evalúa el proceso `corte` (F5-E6, decisión (d)/(e)). */
  corteRegistrado: 'corte-registrado',
  /** Envío a maquila registrado: la RC re-evalúa `envioCostura`/`envioEstampado` según el proceso. */
  envioMaquilaRegistrado: 'envio-maquila-registrado',
  /** Recibo de maquila registrado: la RC re-evalúa `reciboCostura`/`reciboEstampado`. */
  reciboMaquilaRegistrado: 'recibo-maquila-registrado',
  /** Entrega a cliente registrada: la RC re-evalúa `entregaCliente`. */
  entregaClienteRegistrada: 'entrega-cliente-registrada',
  /** Una etapa de corte/envío se CANCELÓ: la RC re-evalúa el proceso (decisión (f), des-completa). */
  etapaCancelada: 'etapa-cancelada',
  /** Un recibo de maquila se CANCELÓ: la RC re-evalúa el proceso de recibo (decisión (f)). */
  reciboMaquilaCancelado: 'recibo-maquila-cancelado',
  /** Una entrega a cliente se CANCELÓ: la RC re-evalúa `entregaCliente` (decisión (f)). */
  entregaClienteCancelada: 'entrega-cliente-cancelada',
} as const;

/** Nombre válido de evento de outbox. */
export type NombreEventoOutbox = (typeof EVENTOS_OUTBOX)[keyof typeof EVENTOS_OUTBOX];

/** Versión actual del contrato del evento `material-recibido`. */
export const VERSION_MATERIAL_RECIBIDO = 1;

/**
 * Versión actual del contrato de los eventos de ETAPA de producción (corte/envío/recibo/entrega y
 * sus cancelaciones) que consume el auto-avance de la RC (F5-E6). Comparten forma (ver
 * {@link EventoEtapaRc}); por eso una sola constante.
 */
export const VERSION_EVENTO_ETAPA_RC = 1;

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
 * Carga COMÚN de los eventos de ETAPA de producción y de su cancelación que consume el auto-avance
 * de la RC (F5-E6). Lleva lo MÍNIMO para que el consumidor reaccione: contra qué orden ocurrió la
 * etapa y, en envío/recibo de maquila, el `idTipoProceso` (define si el proceso RC es de costura o
 * estampado). El consumidor RELEE de la BD las cantidades color×talla (no viajan en el evento): así
 * la re-evaluación es siempre sobre el estado físico ACTUAL y el handler es idempotente.
 *
 * `tipoEtapa` traza qué hecho lo originó (corte/envío/recibo/entrega); en las CANCELACIONES, es el
 * tipo de la etapa cancelada (para que el consumidor sepa qué proceso RC des-completar).
 */
export type EventoEtapaRc = {
  /** Empresa dueña del hecho (A9). */
  idEmpresa: number;
  /** Orden de producción a la que pertenece la etapa. */
  idOrden: number;
  /** Id de la `EtapaMovimiento` que originó (o se canceló en) este evento. */
  idEtapaMovimiento: number;
  /** Tipo de la etapa (`corte`/`envio_maquila`/`recibo_maquila`/`entrega_cliente`). */
  tipoEtapa: string;
  /** Tipo de proceso de maquila (solo envío/recibo; null en corte/entrega). */
  idTipoProceso: number | null;
};

/**
 * Carga del evento de CANCELACIÓN de una recepción de compra (F5-E6, decisión (f)). El consumidor
 * re-evalúa `recepcionTela` de las órdenes ligadas a la OC. Lleva las ÓRDENES afectadas (de las
 * líneas de la OC) ya resueltas por el emisor, para que el consumidor no tenga que recorrer la OC.
 */
export type EventoMaterialRecibidoCancelado = {
  /** Empresa dueña del hecho (A9). */
  idEmpresa: number;
  /** Orden de COMPRA cuya recepción se reversó. */
  idOrdenCompra: number;
  /** Recepción reversada. */
  idRecepcion: number;
  /** Órdenes de PRODUCCIÓN ligadas a la OC (de sus líneas con `idOrden`), sin repetir. */
  idsOrden: number[];
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
