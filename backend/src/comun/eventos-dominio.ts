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
import type { Prisma, TipoHitoOrden } from '../datos/index.js';

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
  /**
   * Una auditoría de calidad se CAPTURÓ/CAMBIÓ de resultado (F6-E2): la RC re-evalúa el proceso
   * `auditoria` de la orden. Idempotente: el consumidor relee el estado físico (¿hay auditoría FINAL
   * aprobada viva?) y auto-completa o des-completa el proceso. Se publica en TODA captura (aprobar,
   * reprobar o limpiar), no solo al aprobar, para que des-completar también funcione (decisión (f)).
   */
  auditoriaCalidadResuelta: 'auditoria-calidad-resuelta',
  /**
   * Una ORDEN de producción NACIÓ por captura (rediseño R3, B5: `salidaAProduccion` o el alta
   * directa de /captura — ambas pasan por `crearOrden`, el punto ÚNICO). El consumidor genera la
   * Ruta Crítica AUTOMÁTICA de la orden ("la RC se programa sola", proto §4.1); la captura NUNCA
   * espera al CPM. El modo migración (`crearOrdenMigrada`) NO lo publica: el histórico no programa RC.
   */
  ordenCreada: 'orden-creada',
  /**
   * Una OC con línea de TELA ligada a una orden se AUTORIZÓ o se CANCELÓ (cierre del hueco de
   * emisores, post-F9): la RC re-evalúa el proceso `compraTela` de la orden. El consumidor relee el
   * estado físico (¿hay una OC VIVA autorizada/recibida con línea de tela ligada a la orden?) →
   * auto-completa o des-completa (idempotente; el evento no es un delta). Se emite POR ORDEN afectada.
   */
  ocTelaResuelta: 'oc-tela-resuelta',
  /**
   * Una nota de salida con línea de AVÍO ligada a una orden se CONFIRMÓ o se CANCELÓ (post-F9): la RC
   * re-evalúa el proceso `surtidoAvios` de la orden. El consumidor relee el estado físico (¿hay una
   * nota CONFIRMADA viva con línea de avío para la orden?) → completa o des-completa. Por orden afectada.
   */
  surtidoAviosResuelto: 'surtido-avios-resuelto',
  /**
   * Un HITO de la orden se REGISTRÓ o se CANCELÓ (post-F9): la RC re-evalúa el proceso ligado al tipo
   * de hito (`hitosOrden.tipoEventoDeHito`). El consumidor relee el estado físico (¿hay un hito VIVO
   * de ese tipo en la orden?) → completa o des-completa. El payload lleva el `tipo` para saber qué
   * proceso re-evaluar; el resto lo relee de la BD (idempotente).
   */
  hitoOrdenResuelto: 'hito-orden-resuelto',
  /**
   * ⭐ Una orden se CERRÓ con un maquilero, o ese cierre se DESHIZO (V1, fila 0.109). El faltante
   * —lo que el maquilero nunca devolvió— quedó saldado (o volvió al pendiente), y con él quedó
   * fijado *«qué pasó con cada prenda»* de ese saldo.
   *
   * 🔑 HOY NADIE LO CONSUME, y está puesto a propósito: es el MISMO acto del que colgará el
   * **congelado del costo** (fila 0.061 — cerrar es el momento en que la orden deja de moverse por
   * ese lado). El despachador del auto-avance ignora en silencio los tipos que no conoce
   * (`ruta-critica/autoAvance.ts`), así que el evento se registra, se publica y espera a su
   * consumidor sin que haya que rediseñar el acto para colgárselo.
   */
  cierreMaquilaResuelto: 'cierre-maquila-resuelto',
} as const;

/** Nombre válido de evento de outbox. */
export type NombreEventoOutbox = (typeof EVENTOS_OUTBOX)[keyof typeof EVENTOS_OUTBOX];

/** Versión actual del contrato del evento `material-recibido`. */
export const VERSION_MATERIAL_RECIBIDO = 1;

/** Versión actual del contrato del evento `auditoria-calidad-resuelta` (F6-E2). */
export const VERSION_AUDITORIA_CALIDAD = 1;

/** Versión actual del contrato del evento `orden-creada` (rediseño R3, B5). */
export const VERSION_ORDEN_CREADA = 1;

/** Versión actual de los eventos `oc-tela-resuelta` y `surtido-avios-resuelto` (post-F9). */
export const VERSION_EVENTO_RC_ORDEN = 1;

/** Versión actual del evento `hito-orden-resuelto` (post-F9). */
export const VERSION_HITO_ORDEN = 1;

/** Versión actual del evento `cierre-maquila-resuelto` (V1, fila 0.109). */
export const VERSION_CIERRE_MAQUILA = 1;

/**
 * Carga del evento `cierre-maquila-resuelto` (V1, fila 0.109). Lleva lo MÍNIMO para que un
 * consumidor reaccione —a qué orden, con qué maquilero y en qué proceso— más el `idCierre` para
 * trazarlo y `deshecho` para saber en qué dirección fue. Como todos los de esta casa, el consumidor
 * RELEE el estado físico de la BD: el evento no es un delta.
 */
export type EventoCierreMaquila = {
  /** Empresa dueña del hecho (A9). */
  idEmpresa: number;
  /** Orden que se cerró (o cuyo cierre se deshizo). */
  idOrden: number;
  /** Maquilero con el que se cerró el saldo. */
  idMaquilero: number;
  /** Proceso de maquila del saldo cerrado. */
  idTipoProceso: number;
  /** Id del `CierreMaquilaOrden`. */
  idCierre: number;
  /** `false` al cerrar, `true` al deshacer. */
  deshecho: boolean;
};

/**
 * Carga del evento `orden-creada` (R3, B5). Lo MÍNIMO para que el consumidor programe la RC
 * automática: a qué orden apunta. El consumidor RELEE de la BD todo lo demás (fecha de entrega,
 * modelo, catálogos RC) — idempotente: si la orden ya tiene RC activa, el evento es un no-op.
 */
export type EventoOrdenCreada = {
  /** Empresa dueña del hecho (A9). */
  idEmpresa: number;
  /** Orden de producción recién creada. */
  idOrden: number;
};

/**
 * Carga del evento `auditoria-calidad-resuelta` (F6-E2). Lo MÍNIMO para que el auto-avance de la RC
 * re-evalúe el proceso `auditoria` de la orden: a qué orden apunta. El consumidor relee de la BD si
 * la orden tiene una auditoría FINAL aprobada VIVA (idempotente: no confía en el evento como delta).
 */
export type EventoAuditoriaCalidad = {
  /** Empresa dueña del hecho (A9). */
  idEmpresa: number;
  /** Orden de producción cuya auditoría se capturó/cambió. */
  idOrden: number;
};

/**
 * Versión actual del contrato de los eventos de ETAPA de producción (corte/envío/recibo/entrega y
 * sus cancelaciones) que consume el auto-avance de la RC (F5-E6). Comparten forma (ver
 * {@link EventoEtapaRc}); por eso una sola constante.
 */
export const VERSION_EVENTO_ETAPA_RC = 1;

/**
 * Un material recibido en un renglón de recepción. `tipo`: `'tela'` (con la `idPartida` creada —
 * desde B1 el inventario de telas entra por COLOR/PARTIDA, ya no por lote), `'avio'` (sin lote ni
 * partida) o `'libre'` (línea no catalogada — informativa, no inventaría).
 *
 * NOTA (M3 — reviewer F4-E3): el evento NO lleva la cantidad recibida. Mezclar unidades heterogéneas
 * (metros de tela + piezas de avío) en un escalar es engañoso y nadie lo usaría para cálculo; el
 * consumidor (F5) relee de la BD la cantidad/costo por renglón si los necesita.
 */
export type MaterialRecibido = {
  tipo: 'tela' | 'avio' | 'libre';
  /** Id del material de catálogo (tela/avío) o null para líneas libres. */
  id: number | null;
  /** LEGADO: lote creado para la tela (D5) o null. Desde B1 las telas ya no crean lote. */
  idLote: number | null;
  /** Partida creada para la tela (B1 — la unidad de entrada por color) o null. Opcional: los
   * eventos escritos ANTES de B1 no la traen (contrato retro-compatible, sin bump de versión). */
  idPartida?: number | null;
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
 * Carga COMÚN de los eventos `oc-tela-resuelta` y `surtido-avios-resuelto` (post-F9). Lo MÍNIMO para
 * que el auto-avance re-evalúe el proceso (`compraTela`/`surtidoAvios`) de la orden: a qué orden
 * apunta. El consumidor RELEE de la BD el estado físico (¿hay una OC de tela viva autorizada / una
 * nota de avíos confirmada viva para la orden?) — idempotente, no confía en el evento como delta.
 */
export type EventoRcOrden = {
  /** Empresa dueña del hecho (A9). */
  idEmpresa: number;
  /** Orden de producción cuyo proceso RC se re-evalúa. */
  idOrden: number;
};

/**
 * Carga del evento `hito-orden-resuelto` (post-F9). Además de la orden, lleva el `tipo` de hito para
 * que el consumidor sepa qué proceso RC re-evaluar (`hitosOrden.tipoEventoDeHito`); el resto (¿hay un
 * hito vivo de ese tipo?) lo relee de la BD. Idempotente.
 */
export type EventoHitoOrden = {
  /** Empresa dueña del hecho (A9). */
  idEmpresa: number;
  /** Orden a la que pertenece el hito. */
  idOrden: number;
  /** Tipo del hito que se registró/canceló (mapea al `TipoEventoProceso` en el consumidor). */
  tipo: TipoHitoOrden;
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
