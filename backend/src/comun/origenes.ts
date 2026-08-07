/**
 * Catálogo único y TIPADO de "orígenes" de un movimiento de kardex (F3-E1).
 *
 * Cada `Movimiento` referencia el HECHO que lo generó con una referencia POLIMÓRFICA
 * (`origenTipo` + `origenId`, ADR-0010 §1; sin FK física, mismo criterio que la Bitácora —
 * ADR-0005). Para que el dominio JAMÁS escriba el discriminador como literal a mano (nit #4
 * del reviewer de F3-E1), TODOS los valores de `origenTipo` viven aquí, en un solo lugar, con
 * tipo estable.
 *
 * Regla: en `dominio/` y en `comun/kardex.ts` se usa SIEMPRE `ORIGEN.<algo>`, nunca el string.
 * Un typo es error de compilación; renombrar un origen es un cambio en un único archivo.
 */

/**
 * Discriminadores de `Movimiento.origenTipo` (kebab-case estable). Se irán agregando conforme
 * cada flujo nazca; en F3-E1 el motor solo ejercita movimientos manuales y traspasos (E3), pero
 * se declaran ya los de recibo/entrega (E4/E5) para fijar el contrato del campo.
 */
export const ORIGEN = {
  /** Movimiento manual de inventario PT (entrada/salida/ajuste — F3-E3). */
  movimientoManual: 'movimiento-manual',
  /** Una de las dos patas de un traspaso entre almacenes (F3-E3). */
  traspaso: 'traspaso',
  /** Movimiento INVERSO que anula a otro (cancelación auditada — D3/A7). */
  cancelacion: 'cancelacion',
  /** Entrada a PT generada por un recibo de costura (`generaEntradaPt` — F3-E4). */
  reciboMaquila: 'recibo-maquila',
  /** Salida de PT por una entrega a cliente (F3-E5). */
  entregaCliente: 'entrega-cliente',
  /** Salida de TELA ligada a una orden de producción (F4-E1 — `Salidas.IdOrdenes`). El `origenId` es el id de la orden. */
  salidaTelaOrden: 'salida-tela-orden',
  /** Entrada de tela/avío por recepción de compra (F4-E3 — el `origenId` es la recepción/OC). */
  recepcionCompra: 'recepcion-compra',
  /**
   * Entrada de TELA por FACTURA/REMISIÓN del proveedor, SIN orden de compra (B1 — la segunda vía de
   * entrada que pidió Daniel, §Post-F9.9 punto 7). El `origenId` es el id del documento `EntradaTela`.
   */
  entradaTela: 'entrada-tela',
  /** Salida de avío por una nota de salida a maquilero (F4-E5 — el `origenId` es la nota). */
  notaSalida: 'nota-salida',
  /** Carga del ETL histórico de inventario (F3-E6 — IPT_Movs; F4-E6 — telas/avíos). */
  migracion: 'migracion',
  /** Ajuste de kardex PT generado por un inventario cíclico (F7-E5). El `origenId` es el id del cíclico. */
  ajusteCiclico: 'ajuste-ciclico',
} as const;

/** Discriminador válido de `Movimiento.origenTipo`. */
export type OrigenMovimiento = (typeof ORIGEN)[keyof typeof ORIGEN];
