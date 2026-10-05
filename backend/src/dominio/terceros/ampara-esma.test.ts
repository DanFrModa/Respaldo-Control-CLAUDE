/**
 * Fila 0.252 — la regla PURA de qué CFDI ampara deuda de EsMa (`debeAmpararEsMa`). La prueba de
 * punta a punta contra Postgres vive en `ampara-esma.int.test.ts`; aquí se pinza cada una de las
 * tres condiciones por separado, con su gemela que la cumple.
 */
import { describe, expect, it } from 'vitest';

import {
  debeAmpararEsMa,
  esMovimientoManualAMaquila,
  SQL_SUMA_AL_SALDO,
  SUMA_AL_SALDO,
} from './ampara-esma.js';

const MAQUILERO = ['maquila-costura'];

describe('debeAmpararEsMa', () => {
  it('factura y nota de crédito SIN OC de un proveedor de maquila: sí', () => {
    expect(
      debeAmpararEsMa({ origen: 'factura_proveedor', refTipo: undefined, codigosDeRol: MAQUILERO }),
    ).toBe(true);
    expect(
      debeAmpararEsMa({ origen: 'nota_credito', refTipo: null, codigosDeRol: MAQUILERO }),
    ).toBe(true);
  });

  it('cualquier rol de EsMa cuenta como maquila (corte y empaque incluidos)', () => {
    for (const rol of ['estampado', 'bordado', 'lavado', 'aplicacion', 'corte', 'empaque']) {
      expect(
        debeAmpararEsMa({ origen: 'factura_proveedor', refTipo: undefined, codigosDeRol: [rol] }),
      ).toBe(true);
    }
  });

  it('CON orden de compra: no (el caso mixto sigue siendo deuda del motor)', () => {
    expect(
      debeAmpararEsMa({
        origen: 'factura_proveedor',
        refTipo: 'orden-compra',
        codigosDeRol: MAQUILERO,
      }),
    ).toBe(false);
  });

  it('proveedor que NO es de maquila: no (aunque tenga otros roles)', () => {
    expect(
      debeAmpararEsMa({ origen: 'factura_proveedor', refTipo: undefined, codigosDeRol: ['tela'] }),
    ).toBe(false);
    expect(
      debeAmpararEsMa({ origen: 'factura_proveedor', refTipo: undefined, codigosDeRol: [] }),
    ).toBe(false);
  });

  it('un origen que no es CFDI (pago, entrada sin factura): no', () => {
    for (const origen of ['pago', 'entrada_sin_factura', 'abono', 'descuento'] as const) {
      expect(debeAmpararEsMa({ origen, refTipo: undefined, codigosDeRol: MAQUILERO })).toBe(false);
    }
  });
});

describe('esMovimientoManualAMaquila (la guarda)', () => {
  it('cargo, pago, abono y descuento a un maquilero: sí (van en EsMa)', () => {
    for (const origen of ['entrada_sin_factura', 'pago', 'abono', 'descuento'] as const) {
      expect(esMovimientoManualAMaquila({ origen, codigosDeRol: MAQUILERO })).toBe(true);
    }
  });

  it('los mismos orígenes a quien NO es de maquila: no', () => {
    for (const origen of ['entrada_sin_factura', 'pago', 'abono', 'descuento'] as const) {
      expect(esMovimientoManualAMaquila({ origen, codigosDeRol: ['tela'] })).toBe(false);
    }
  });

  it('factura y nota de crédito a un maquilero no se rechazan (entran como comprobante)', () => {
    for (const origen of ['factura_proveedor', 'nota_credito'] as const) {
      expect(esMovimientoManualAMaquila({ origen, codigosDeRol: MAQUILERO })).toBe(false);
    }
  });
});

describe('el predicado único', () => {
  it('Prisma y SQL dicen lo mismo: suma lo que NO ampara EsMa', () => {
    expect(SUMA_AL_SALDO).toEqual({ amparaEsMa: false });
    expect(SQL_SUMA_AL_SALDO.sql).toBe('NOT m."ampara_esma"');
  });
});
