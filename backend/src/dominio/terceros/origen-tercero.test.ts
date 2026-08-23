/**
 * Tests UNITARIOS de la convención de signo del motor de terceros (F9-E1). La regla de signo es el
 * núcleo del motor ("saldo = Σ monto con signo"): un signo equivocado descuadra TODO. Se prueba pura
 * (sin base de datos).
 */
import { describe, expect, it } from 'vitest';

import { OrigenMovimientoTercero } from '../../datos/index.js';

import { ORIGENES_ABONO, ORIGENES_CARGO, esOrigenCargo, signoDeOrigen } from './origen-tercero.js';

describe('signo por origen (motor de terceros)', () => {
  it('los cargos AUMENTAN el saldo (signo +1)', () => {
    for (const origen of [
      OrigenMovimientoTercero.recibo_maquila,
      OrigenMovimientoTercero.factura_proveedor,
      OrigenMovimientoTercero.entrada_sin_factura,
    ]) {
      expect(signoDeOrigen(origen)).toBe(1);
      expect(esOrigenCargo(origen)).toBe(true);
    }
  });

  it('los abonos/pagos/notas de crédito/descuentos DISMINUYEN el saldo (signo −1)', () => {
    for (const origen of [
      OrigenMovimientoTercero.nota_credito,
      OrigenMovimientoTercero.pago,
      OrigenMovimientoTercero.abono,
      OrigenMovimientoTercero.descuento,
    ]) {
      expect(signoDeOrigen(origen)).toBe(-1);
      expect(esOrigenCargo(origen)).toBe(false);
    }
  });

  it('la nota de crédito BAJA el saldo (regla de negocio D15/§3.5)', () => {
    expect(signoDeOrigen(OrigenMovimientoTercero.nota_credito)).toBe(-1);
  });

  it('TODO origen del enum está clasificado (cargo o abono), sin traslapes ni huecos', () => {
    const todos = Object.values(OrigenMovimientoTercero);
    for (const origen of todos) {
      const enCargo = ORIGENES_CARGO.has(origen);
      const enAbono = ORIGENES_ABONO.has(origen);
      // exactamente uno de los dos (XOR): ni sin clasificar ni en ambos.
      expect(enCargo !== enAbono).toBe(true);
      // y no lanza (todo origen tiene signo).
      expect(() => signoDeOrigen(origen)).not.toThrow();
    }
    expect(ORIGENES_CARGO.size + ORIGENES_ABONO.size).toBe(todos.length);
  });
});
