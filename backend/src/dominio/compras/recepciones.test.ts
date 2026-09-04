import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { EstatusOrdenCompra } from '../../datos/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  calcularEstatusRecepcion,
  importeDeRecepcion,
  nombreMaterialDeLinea,
  precioDelRenglon,
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

/**
 * ⭐⭐ FILA 0.129 — EL PRECIO CON EL QUE NACE LA DEUDA, y el importe que se le va a deber.
 *
 * Daniel (§Post-F9.192): *"el precio debería de ser el de la OC, la cantidad puede variar un poco,
 * por eso se mete a mano"*. Las dos funciones son PURAS a propósito: la regla del dinero se puede
 * medir sin base de datos, que es donde antes se escondía.
 */
describe('Recepción unit — el precio del renglón (fila 0.129)', () => {
  it('sin precio capturado manda el de la OC', () => {
    expect(precioDelRenglon(12.5, undefined)).toBe(12.5);
  });

  it('con precio capturado manda el capturado (quien recibe ve la mercancía)', () => {
    expect(precioDelRenglon(12.5, 13.75)).toBe(13.75);
  });

  it('un precio capturado de CERO se respeta: no se cae al de la OC', () => {
    // El `?? ` importa: con `||` un 0 legítimo (mercancía sin cargo) se habría convertido en el
    // precio de la OC y habría nacido una deuda que nadie pidió.
    expect(precioDelRenglon(12.5, 0)).toBe(0);
  });
});

describe('Recepción unit — lo que se le debe al proveedor (fila 0.129)', () => {
  it('suma cantidad × precio de cada renglón', () => {
    expect(
      importeDeRecepcion([
        { cantidad: 100, precio: 2.5 },
        { cantidad: 10, precio: 1 },
      ]),
    ).toBe(260);
  });

  it('los renglones LIBRES también cuentan: no se inventarían, pero se pagan', () => {
    // Un flete de $500 capturado como renglón libre pesa igual que un avío.
    expect(importeDeRecepcion([{ cantidad: 1, precio: 500 }])).toBe(500);
  });

  it('un renglón sin precio aporta 0 (no se inventa ninguno)', () => {
    expect(
      importeDeRecepcion([
        { cantidad: 100, precio: null },
        { cantidad: 2, precio: 3 },
      ]),
    ).toBe(6);
  });

  it('sin renglones el importe es 0 (y arriba nadie registra una deuda de cero)', () => {
    expect(importeDeRecepcion([])).toBe(0);
  });
});
