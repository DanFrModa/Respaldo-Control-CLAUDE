/**
 * LOS TOTALES DE UNA RELACIÓN DE PAGO (fila 0.113) — pieza PURA, sin base de datos.
 *
 * Daniel cierra su Excel con dos números por separado: *«30,000 efectivo + 108,201 transferencia»*.
 * Ésos son los totales de la relación, y se calculan igual en la pantalla, en la sección, en el
 * concentrado y en el Excel exportado — por eso viven aquí y no en cuatro sitios.
 *
 * ⭐ **Sólo cuentan los renglones CON monto** (`> 0`). Un renglón en cero es normal —así se cargan
 * los conceptos predeterminados, *«para que siempre se carguen en cero para que yo le ponga la
 * cantidad»*— pero no es un pago: no suma, no se cuenta y no sale en la relación ejecutable.
 */
import type { FormaDePagoClave, TotalesPago } from '../../contrato/index.js';

/** Redondeo monetario a 2 decimales (mismo criterio que el resto del sistema). */
export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Lo mínimo que necesita un renglón para entrar a los totales. */
export interface RenglonSumable {
  monto: number;
  formaPago: FormaDePagoClave;
}

/**
 * ¿Este renglón SALE en la relación ejecutable? Sólo los que llevan monto.
 *
 * Con tolerancia de medio centavo, igual que `tieneSaldo` en la fórmula del saldo: comparar contra
 * `0` a secas deja la puerta abierta a que un residuo de coma flotante cuele un renglón fantasma
 * de $0.00 en la lista que va al banco.
 */
export function tieneMonto(monto: number): boolean {
  return monto >= 0.005;
}

/**
 * Los totales de un conjunto de renglones: efectivo, transferencia, el total y CUÁNTOS renglones
 * llevan monto.
 *
 * `puedeVerImportes` oculta los tres importes (viajan en `null`) pero **nunca el conteo**: no es un
 * importe, y sin él quien no puede ver dinero tampoco sabría que hay pagos — misma regla que
 * `pendienteParaSalida` en la fórmula del saldo.
 */
export function totalesDe(
  renglones: readonly RenglonSumable[],
  puedeVerImportes: boolean,
): TotalesPago {
  let efectivo = 0;
  let transferencia = 0;
  let cuenta = 0;
  for (const r of renglones) {
    if (!tieneMonto(r.monto)) continue;
    cuenta += 1;
    if (r.formaPago === 'efectivo') {
      efectivo += r.monto;
    } else {
      transferencia += r.monto;
    }
  }
  const oculto = (v: number): number | null => (puedeVerImportes ? redondear2(v) : null);
  return {
    efectivo: oculto(efectivo),
    transferencia: oculto(transferencia),
    total: oculto(efectivo + transferencia),
    renglones: cuenta,
  };
}
