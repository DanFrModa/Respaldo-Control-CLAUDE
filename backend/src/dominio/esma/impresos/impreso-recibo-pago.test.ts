import { describe, expect, it } from 'vitest';

import {
  generarPdfReciboPago,
  pagadorDeEmpresa,
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
    };
    const buffer = await generarPdfReciboPago(datos);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
  });
});
