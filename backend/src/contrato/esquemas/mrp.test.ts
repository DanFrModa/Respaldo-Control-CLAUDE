import { describe, expect, it } from 'vitest';

import { esquemaGenerarOcCuerpo } from './mrp.js';

/**
 * Unit del CONTRATO de la compra desde la explosión — la primera puerta, la que ni siquiera deja
 * llegar al dominio lo que no tiene sentido.
 *
 * ⭐⭐ V1-E3z (§Post-F9.94) — el ajuste del comprador dejó de ser "sólo la cantidad": ahora lleva
 * cantidad, precio, o los dos, cada uno OPCIONAL por separado. Esa flexibilidad abre exactamente dos
 * puertas que hay que cerrar aquí: un ajuste que no dice NADA (ni cantidad ni precio), y un precio
 * NEGATIVO. Las dos se rechazan en el contrato, antes de tocar la base.
 */
const base = { idsOrden: [1], idsRequerimiento: [] };

describe('esquemaGenerarOcCuerpo — el AJUSTE del comprador (§Post-F9.86 + §Post-F9.94)', () => {
  it('acepta un ajuste de sólo CANTIDAD (lo que ya existía)', () => {
    const r = esquemaGenerarOcCuerpo.safeParse({
      ...base,
      ajustes: [{ tipo: 'avio', idMaterial: 3, idProveedor: 11, cantidadTotal: 300 }],
    });
    expect(r.success).toBe(true);
  });

  it('⭐ acepta un ajuste de sólo PRECIO (lo nuevo de V1-E3z)', () => {
    const r = esquemaGenerarOcCuerpo.safeParse({
      ...base,
      ajustes: [{ tipo: 'avio', idMaterial: 3, idProveedor: 11, precioUnitario: 4.25 }],
    });
    expect(r.success).toBe(true);
  });

  it('⭐ acepta el precio en CERO: es un ajuste ("la línea nace sin precio"), no un vacío', () => {
    const r = esquemaGenerarOcCuerpo.safeParse({
      ...base,
      ajustes: [{ tipo: 'avio', idMaterial: 3, idProveedor: 11, precioUnitario: 0 }],
    });
    expect(r.success).toBe(true);
  });

  it('🔴 rechaza un precio NEGATIVO (una compra no se paga en negativo)', () => {
    const r = esquemaGenerarOcCuerpo.safeParse({
      ...base,
      ajustes: [{ tipo: 'avio', idMaterial: 3, idProveedor: 11, precioUnitario: -1 }],
    });
    expect(r.success).toBe(false);
  });

  it('🔴 rechaza un ajuste que no dice NADA (ni cantidad ni precio)', () => {
    const r = esquemaGenerarOcCuerpo.safeParse({
      ...base,
      ajustes: [{ tipo: 'avio', idMaterial: 3, idProveedor: 11 }],
    });
    expect(r.success).toBe(false);
  });

  it('🔴 rechaza la cantidad en CERO (eso no es "compra 0", es un campo mal llenado)', () => {
    const r = esquemaGenerarOcCuerpo.safeParse({
      ...base,
      ajustes: [{ tipo: 'avio', idMaterial: 3, idProveedor: 11, cantidadTotal: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it('🔴 rechaza un precio que no cabe en la columna de la orden de compra', () => {
    const r = esquemaGenerarOcCuerpo.safeParse({
      ...base,
      ajustes: [{ tipo: 'avio', idMaterial: 3, idProveedor: 11, precioUnitario: 1e11 }],
    });
    expect(r.success).toBe(false);
  });

  it('acepta los dos campos juntos, con color', () => {
    const r = esquemaGenerarOcCuerpo.safeParse({
      ...base,
      ajustes: [
        {
          tipo: 'tela',
          idMaterial: 8,
          idTelaColor: 4,
          idProveedor: 11,
          cantidadTotal: 60,
          precioUnitario: 105.5,
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});
