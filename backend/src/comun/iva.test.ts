/**
 * EL IVA (fila 0.118). Lo que se mide aquí es lo único que este módulo promete: que el total se
 * parte en dos cifras que **vuelven a sumar el total, al centavo**.
 *
 * Importa porque es dinero que alguien va a timbrar: si el subtotal y el IVA se calcularan por
 * separado y cada uno se redondeara, habría totales que difieren un centavo del depósito — y
 * entonces la factura del proveedor no cuadra con la transferencia, que es justo el descuadre que
 * el documento para facturar vino a evitar.
 */
import { describe, expect, it } from 'vitest';

import { desglosarIva, TASA_IVA, TASA_IVA_TEXTO } from './iva.js';

describe('desglosarIva', () => {
  it('el caso limpio: 116.00 se parte en 100.00 + 16.00', () => {
    expect(desglosarIva(116)).toEqual({ subtotal: 100, iva: 16, total: 116 });
  });

  it('⭐ un total redondo NO da cifras redondas, y aun así cuadra: 100.00 → 86.21 + 13.79', () => {
    expect(desglosarIva(100)).toEqual({ subtotal: 86.21, iva: 13.79, total: 100 });
  });

  it('el centavo suelto no se pierde ni se duplica', () => {
    expect(desglosarIva(0.01)).toEqual({ subtotal: 0.01, iva: 0, total: 0.01 });
  });

  it('cero es cero (un renglón sin monto no llega aquí, pero no revienta si llega)', () => {
    expect(desglosarIva(0)).toEqual({ subtotal: 0, iva: 0, total: 0 });
  });

  it('⭐ subtotal + iva === total en cien totales distintos (la promesa del módulo)', () => {
    // Recorre importes con toda clase de residuos: enteros, medios pesos y centavos sueltos.
    for (let centavos = 1; centavos <= 100_000; centavos += 997) {
      const total = centavos / 100;
      const d = desglosarIva(total);
      expect(Math.round((d.subtotal + d.iva) * 100), `total ${String(total)}`).toBe(
        Math.round(d.total * 100),
      );
      expect(d.total, `total ${String(total)}`).toBe(total);
    }
  });

  it('un total con más de dos decimales se redondea antes de partirlo', () => {
    // 116.004 es un total imposible de transferir: se trata como 116.00.
    expect(desglosarIva(116.004)).toEqual({ subtotal: 100, iva: 16, total: 116 });
  });

  it('la tasa vive en UN solo sitio y su texto se deriva de ella', () => {
    expect(TASA_IVA).toBe(0.16);
    expect(TASA_IVA_TEXTO).toBe('16 %');
  });
});
