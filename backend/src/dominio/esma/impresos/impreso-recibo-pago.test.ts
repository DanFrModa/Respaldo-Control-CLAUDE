import { describe, expect, it } from 'vitest';

import {
  generarPdfReciboPago,
  pagadorDeEmpresa,
  textoSelloAnulado,
  type DatosImpresoReciboPago,
} from './impreso-recibo-pago.js';

/**
 * Unit del impreso del RECIBO DE PAGO (F6-E4, R9) — SIN Postgres. Cubre que el PAGADOR sale del
 * nombre/razón social de la empresa (decisión (h), NO hardcodeado) y que el PDF se genera.
 */
describe('impreso recibo de pago (F6-E4)', () => {
  it('pagador = razón social si la tiene, si no el nombre (decisión h)', () => {
    expect(pagadorDeEmpresa({ razonSocial: 'FR MODA SA DE CV', nombre: 'Marilyn' })).toBe(
      'FR MODA SA DE CV',
    );
    expect(pagadorDeEmpresa({ razonSocial: null, nombre: 'FR Moda' })).toBe('FR Moda');
  });

  it('genera un PDF (buffer que empieza con %PDF) con el pagador de la empresa', async () => {
    const datos: DatosImpresoReciboPago = {
      pagador: 'FR MODA SA DE CV',
      folioPago: 7,
      maquilero: 'Maquila Costura SA',
      fecha: '2026-07-01',
      monto: 800,
      conFactura: true,
      observaciones: 'pago de la semana',
      renglones: [{ folioOrden: 100, tipoProceso: 'Costura', cantidad: 100, importe: 800 }],
      canceladoEn: null,
      motivoCancelacion: null,
    };
    const buffer = await generarPdfReciboPago(datos);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⭐⭐ FILA 0.145 — EL RECIBO DE UN PAGO ANULADO TIENE QUE DECIRLO
  //
  // Este PDF es el papel que se le entrega al maquilero. Antes de la 0.145 un pago NO se podía
  // anular nunca, así que el impreso no tenía nada que decir; la fila creó ese estado, y un
  // comprobante anulado que no lo dice **se puede cobrar dos veces**.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  it('un pago VIVO no lleva sello', () => {
    expect(textoSelloAnulado({ canceladoEn: null, motivoCancelacion: null })).toBeNull();
  });

  it('🔴 un pago ANULADO lleva el sello, y el sello dice que NO es comprobante de pago', () => {
    const sello = textoSelloAnulado({
      canceladoEn: '2026-09-06T12:00:00.000Z',
      motivoCancelacion: 'se tecleó de más',
    });
    expect(sello).not.toBeNull();
    expect(sello?.titulo).toContain('ANULADO');
    expect(sello?.titulo).toContain('NO ES COMPROBANTE DE PAGO');
    // La fecha en que se anuló y el motivo, para que el papel se explique solo.
    expect(sello?.detalle).toContain('2026-09-06');
    expect(sello?.detalle).toContain('se tecleó de más');
  });

  it('sin motivo, el sello sale igual (lo que no puede faltar es el aviso)', () => {
    const sello = textoSelloAnulado({
      canceladoEn: '2026-09-06T12:00:00.000Z',
      motivoCancelacion: null,
    });
    expect(sello?.titulo).toContain('ANULADO');
    expect(sello?.detalle).not.toContain('Motivo');
  });

  it('el PDF de un pago anulado SÍ se genera (hace falta la copia), pero con el sello dentro', async () => {
    const base: DatosImpresoReciboPago = {
      pagador: 'FR MODA SA DE CV',
      folioPago: 7,
      maquilero: 'Maquila Costura SA',
      fecha: '2026-07-01',
      monto: 800,
      conFactura: true,
      observaciones: null,
      renglones: [],
      canceladoEn: null,
      motivoCancelacion: null,
    };
    const vivo = await generarPdfReciboPago(base);
    const anulado = await generarPdfReciboPago({
      ...base,
      canceladoEn: '2026-09-06T12:00:00.000Z',
      motivoCancelacion: 'se tecleó de más',
    });
    expect(anulado.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // El documento anulado lleva un bloque de más: no puede pesar lo mismo que el vivo.
    expect(anulado.length).not.toBe(vivo.length);
  });
});
