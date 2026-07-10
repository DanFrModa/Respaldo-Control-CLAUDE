/**
 * SIGNO de un movimiento de cuenta de terceros por su ORIGEN (F9-E1; D12/D15/R10; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §3.3). Este módulo es el ÚNICO lugar de
 * verdad de la convención de signo (A1); el resto del sistema no la re-decide.
 *
 * Convención (la misma para CxC y CxP — el saldo es neutro al tipo de cuenta):
 *  • CARGO (+): AUMENTA el saldo del tercero en su cuenta. Orígenes: `recibo_maquila`,
 *    `factura_proveedor`, `entrada_sin_factura`, `factura_cliente`. Para un PROVEEDOR (CxP) = "le
 *    debemos más"; para un CLIENTE (CxC) = "nos debe más" (`factura_cliente` = venta a crédito, F9-E4).
 *  • ABONO (−): DISMINUYE el saldo. Orígenes: `nota_credito`, `pago`, `abono`, `descuento`. Las
 *    notas de crédito son un movimiento que BAJA el saldo (propuesta §3.5).
 *
 * `saldo(tercero) = Σ monto` (con el signo ya aplicado — D3). El API recibe `importe` positivo y el
 * dominio le pone el signo con `signoDeOrigen`. EsMa (F6) usa su PROPIA convención en sus tablas
 * (ahí `abono` es un cargo extra al maquilero, +): NO se mezcla — la convivencia de EsMa proyecta sus
 * renglones con su signo, en su propia `fuente`; este módulo solo rige el motor nuevo.
 */
import { OrigenMovimientoTercero } from '../../datos/index.js';

/** Orígenes que son CARGO (aumentan el saldo → monto +). */
export const ORIGENES_CARGO: ReadonlySet<OrigenMovimientoTercero> = new Set([
  OrigenMovimientoTercero.recibo_maquila,
  OrigenMovimientoTercero.factura_proveedor,
  OrigenMovimientoTercero.entrada_sin_factura,
  OrigenMovimientoTercero.factura_cliente,
]);

/** Orígenes que son ABONO/reducción (disminuyen el saldo → monto −). */
export const ORIGENES_ABONO: ReadonlySet<OrigenMovimientoTercero> = new Set([
  OrigenMovimientoTercero.nota_credito,
  OrigenMovimientoTercero.pago,
  OrigenMovimientoTercero.abono,
  OrigenMovimientoTercero.descuento,
]);

/** ¿El origen es un cargo (aumenta el saldo)? */
export function esOrigenCargo(origen: OrigenMovimientoTercero): boolean {
  return ORIGENES_CARGO.has(origen);
}

/**
 * Signo (+1 cargo / −1 abono) de un origen. Es total sobre el enum: si algún día se agrega un origen
 * y no se clasifica aquí, lanza — un origen sin signo definido NO puede registrarse (falla ruidosa,
 * nunca un signo silencioso equivocado).
 */
export function signoDeOrigen(origen: OrigenMovimientoTercero): 1 | -1 {
  if (ORIGENES_CARGO.has(origen)) {
    return 1;
  }
  if (ORIGENES_ABONO.has(origen)) {
    return -1;
  }
  throw new Error(`Origen de movimiento de tercero sin signo definido: ${String(origen)}.`);
}
