/**
 * La regla —UNA sola vez— de que **el ajuste de un inventario cíclico no se deshace desde
 * Inventarios** (fila 0.099).
 *
 * `generarAjusteCiclico` deja la hoja en `cerrado`, y `cancelarInventarioCiclico` rechaza justo ese
 * estado: el ÚNICO estado en el que existe un movimiento `ajuste-ciclico` es aquel en el que el
 * cíclico se niega a deshacerse. Producto terminado ya lo cerraba (`movimientos-pt.ts` sólo cancela
 * a mano lo que se capturó a mano). Al abrir el cíclico a TELAS y AVÍOS, esos movimientos empezaron
 * a caer en unas cancelaciones que aceptan cualquier movimiento con renglones de su dimensión — o
 * sea, la misma puerta de atrás que la fila 0.104 tuvo que cerrar para las salidas sin orden: el
 * movimiento se revertiría y la hoja se quedaría `cerrado`, contando otra historia que el kardex.
 *
 * El texto vive aquí y lo usan las TRES dimensiones para que no pueda pasar que producto terminado
 * diga una cosa y telas otra.
 */
import { ErrorValidacion } from '../../comun/errores.js';
import { ORIGEN, type OrigenMovimiento } from '../../comun/origenes.js';

/** Qué se le dice a quien intenta anular el ajuste de un cíclico (y qué hacer en su lugar). */
export const DONDE_CANCELAR_AJUSTE_CICLICO =
  'lo generó el AJUSTE de un INVENTARIO CÍCLICO ya cerrado, que no tiene marcha atrás. Si el ' +
  'conteo estuvo mal, corrige la existencia con un movimiento manual NUEVO, no anulando el ajuste';

/**
 * Rechaza cancelar un movimiento nacido del ajuste de un cíclico. Se llama DENTRO de la transacción
 * de la cancelación, con el `origenTipo` del movimiento ORIGINAL.
 */
export function exigirCancelableFueraDelCiclico(origenTipo: string | null): void {
  if (origenTipo === (ORIGEN.ajusteCiclico as OrigenMovimiento as string)) {
    throw new ErrorValidacion(`Este movimiento no se cancela desde aquí: ${DONDE_CANCELAR_AJUSTE_CICLICO}.`);
  }
}
