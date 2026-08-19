/**
 * Pruebas de la segmentación con/sin factura de CxP (V1-E3f pieza B, §Post-F9.57).
 *
 * Lo que se está protegiendo: que la modalidad del proveedor MANDE (la regla que EsMa ya tenía) y
 * que, aun así, un origen que es sin-factura por definición NO se vuelva fiscal — un cargo fiscal
 * sin comprobante que lo respalde ensuciaría el reporte del contador sin que nadie se enterara.
 */
import { describe, expect, it } from 'vitest';

import { ErrorValidacion } from '../../../comun/errores.js';
import { resolverSegmentoCxp, segmentoWhere } from './facturacion-cxp.js';

describe('resolverSegmentoCxp — la modalidad del proveedor manda', () => {
  it('solo_con fuerza CON factura, aunque se pida lo contrario', () => {
    expect(resolverSegmentoCxp('pago', 'solo_con', undefined)).toBe(true);
    expect(resolverSegmentoCxp('pago', 'solo_con', false)).toBe(true);
  });

  it('solo_sin fuerza SIN factura, aunque se pida lo contrario', () => {
    expect(resolverSegmentoCxp('pago', 'solo_sin', undefined)).toBe(false);
    expect(resolverSegmentoCxp('pago', 'solo_sin', true)).toBe(false);
  });

  it('⭐ `ambos` EXIGE que se indique: no elige por su cuenta', () => {
    expect(resolverSegmentoCxp('pago', 'ambos', true)).toBe(true);
    expect(resolverSegmentoCxp('pago', 'ambos', false)).toBe(false);
    // Éste es el caso que Daniel quiere partir en dos: elegir "sin factura" en silencio sería
    // meter dinero en el segmento equivocado sin que nadie lo note.
    expect(() => resolverSegmentoCxp('pago', 'ambos', undefined)).toThrow(ErrorValidacion);
  });

  it('sin modalidad definida (proveedor migrado) respeta lo que se mandó; si no, sin factura', () => {
    expect(resolverSegmentoCxp('pago', null, true)).toBe(true);
    expect(resolverSegmentoCxp('pago', null, false)).toBe(false);
    // Es el comportamiento que CxP ya tenía (el esquema traía `.default(false)`): no cambia
    // ningún saldo existente.
    expect(resolverSegmentoCxp('pago', null, undefined)).toBe(false);
  });
});

describe('resolverSegmentoCxp — el ORIGEN manda sobre la modalidad', () => {
  it('⭐ una entrada sin factura NUNCA es fiscal, ni con un proveedor que siempre factura', () => {
    expect(resolverSegmentoCxp('entrada_sin_factura', 'solo_con', undefined)).toBe(false);
    expect(resolverSegmentoCxp('entrada_sin_factura', 'ambos', undefined)).toBe(false);
    expect(resolverSegmentoCxp('entrada_sin_factura', null, false)).toBe(false);
  });

  it('y si se pide marcarla como fiscal, se RECHAZA (no se corrige en silencio, D3)', () => {
    expect(() => resolverSegmentoCxp('entrada_sin_factura', 'solo_con', true)).toThrow(
      ErrorValidacion,
    );
  });

  it('los demás orígenes SÍ pasan por la modalidad', () => {
    for (const origen of ['nota_credito', 'pago', 'abono', 'descuento'] as const) {
      expect(resolverSegmentoCxp(origen, 'solo_con', undefined)).toBe(true);
      expect(() => resolverSegmentoCxp(origen, 'ambos', undefined)).toThrow(ErrorValidacion);
    }
  });
});

describe('segmentoWhere', () => {
  it('todos no filtra; con/sin filtran esFiscal', () => {
    expect(segmentoWhere('todos')).toEqual({});
    expect(segmentoWhere('con')).toEqual({ esFiscal: true });
    expect(segmentoWhere('sin')).toEqual({ esFiscal: false });
  });
});
