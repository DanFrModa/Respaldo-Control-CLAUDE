import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { EstatusOrdenCompra } from '../../datos/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  calcularEstatusRecepcion,
  nombreMaterialDeLinea,
  recibirCompra,
  reversarRecepcion,
} from './recepciones.js';

/**
 * Unit del dominio de RECEPCIÓN de compras (F4-E3) — SIN Postgres. Cubre lo que NO necesita la base:
 *  • el guard de permisos (deny-by-default, A4): recibir/reversar exigen `compras.recibir`;
 *  • la validación de captura por Zod que falla ANTES de tocar la base (recibir sin renglones,
 *    reversar sin motivo, cantidad inválida);
 *  • la función PURA de recálculo de estatus de la OC (parcial/total/autorizada, R7).
 *
 * La conversión cantidad+costo (caso reina 15 rollos→750 m, importe idéntico) ya se prueba en
 * `recepciones.int.test.ts`. La integridad transaccional real (atomicidad, kardex, outbox,
 * existencia = Σ movimientos, reverso visible en kardex, regla b contra Postgres) va en
 * `recepciones.int.test.ts` (CI).
 */

const sesionRecibir = () => sesionDePrueba({ permisos: ['compras.ver', 'compras.recibir'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['compras.ver'] });

describe('Recepción unit — permisos (A4, deny-by-default)', () => {
  it('recibirCompra sin compras.recibir lanza ErrorPermiso (antes de la BD)', async () => {
    await expect(
      recibirCompra(sesionSoloVer(), {
        idOrdenCompra: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: 1, cantidad: 10 }],
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('reversarRecepcion sin compras.recibir lanza ErrorPermiso', async () => {
    await expect(reversarRecepcion(sesionSoloVer(), 1, { motivo: 'error' })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('Recepción unit — validación de captura (Zod, antes de la BD)', () => {
  it('recibirCompra sin renglones lanza ErrorValidacion', async () => {
    await expect(
      recibirCompra(sesionRecibir(), {
        idOrdenCompra: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        lineas: [],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('recibirCompra con cantidad cero lanza ErrorValidacion', async () => {
    await expect(
      recibirCompra(sesionRecibir(), {
        idOrdenCompra: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: 1, cantidad: 0 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('reversarRecepcion sin motivo lanza ErrorValidacion', async () => {
    await expect(
      // @ts-expect-error: motivo es obligatorio; probamos la validación en runtime
      reversarRecepcion(sesionRecibir(), 1, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('Recepción unit — recálculo de estatus de OC (R7, función pura)', () => {
  const lineas = [
    { id: 10, pedido: 100 },
    { id: 20, pedido: 50 },
  ];

  it('nada recibido → autorizada (caso del reverso total)', () => {
    expect(calcularEstatusRecepcion(lineas, new Map())).toBe(EstatusOrdenCompra.autorizada);
  });

  it('algo recibido pero no todo → recibida_parcial', () => {
    const recibido = new Map([
      [10, 40],
      [20, 0],
    ]);
    expect(calcularEstatusRecepcion(lineas, recibido)).toBe(EstatusOrdenCompra.recibida_parcial);
  });

  it('una línea completa y la otra a medias → recibida_parcial', () => {
    const recibido = new Map([
      [10, 100],
      [20, 25],
    ]);
    expect(calcularEstatusRecepcion(lineas, recibido)).toBe(EstatusOrdenCompra.recibida_parcial);
  });

  it('todas completas → recibida_total', () => {
    const recibido = new Map([
      [10, 100],
      [20, 50],
    ]);
    expect(calcularEstatusRecepcion(lineas, recibido)).toBe(EstatusOrdenCompra.recibida_total);
  });

  it('recibir de más (≥ pedido) cuenta como completa → recibida_total', () => {
    const recibido = new Map([
      [10, 120],
      [20, 50],
    ]);
    expect(calcularEstatusRecepcion(lineas, recibido)).toBe(EstatusOrdenCompra.recibida_total);
  });

  it('completa con diferencia ≤ tolerancia de redondeo → recibida_total', () => {
    // 99.9999995 ≈ 100 dentro de la tolerancia 1e-6.
    const recibido = new Map([
      [10, 100 - 5e-7],
      [20, 50],
    ]);
    expect(calcularEstatusRecepcion(lineas, recibido)).toBe(EstatusOrdenCompra.recibida_total);
  });
});

describe('⭐ V1-E8c — el nombre del renglón al RECIBIR lleva su color', () => {
  // 🔴 Estas cuatro pruebas nacieron de una MUTACIÓN QUE SOBREVIVIÓ: el reviewer le quitó el color
  // a esta función y las 2 086 pruebas del backend siguieron en verde. Es el OTRO EXTREMO de la
  // cadena que V1-E8c abre: partir la compra en cuatro renglones por color no sirve de nada si al
  // recibir los cuatro vuelven a llamarse igual.
  const avio = { clave: 'CIE-53', descripcion: 'Cierre Venus' };

  it('⭐ dos colores del MISMO avío se leen DISTINTO (era el defecto que sobrevivía)', () => {
    const rojo = nombreMaterialDeLinea({
      avio,
      tela: null,
      colorAvio: 'Rojo',
      descripcionLibre: null,
    });
    const azul = nombreMaterialDeLinea({
      avio,
      tela: null,
      colorAvio: 'Azul',
      descripcionLibre: null,
    });

    expect(rojo).toBe('CIE-53 — Cierre Venus · Rojo');
    expect(azul).toBe('CIE-53 — Cierre Venus · Azul');
    expect(rojo).not.toBe(azul);
  });

  it('sin color, el nombre es el de siempre (las OC viejas no cambian)', () => {
    expect(
      nombreMaterialDeLinea({ avio, tela: null, colorAvio: null, descripcionLibre: null }),
    ).toBe('CIE-53 — Cierre Venus');
  });

  it('un color VACÍO se trata como sin color, no deja un separador colgando', () => {
    expect(nombreMaterialDeLinea({ avio, tela: null, colorAvio: '', descripcionLibre: null })).toBe(
      'CIE-53 — Cierre Venus',
    );
  });

  it('sin avío ni tela cae a la descripción libre, y sin ella lo dice', () => {
    expect(
      nombreMaterialDeLinea({ avio: null, tela: null, colorAvio: null, descripcionLibre: 'Flete' }),
    ).toBe('Flete');
    expect(
      nombreMaterialDeLinea({ avio: null, tela: null, colorAvio: null, descripcionLibre: null }),
    ).toBe('(sin material)');
  });
});
