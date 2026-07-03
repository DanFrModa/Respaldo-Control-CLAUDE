/**
 * Tests UNITARIOS de las fórmulas PURAS del costo de orden (F7-E1; D1/D2):
 *  • `teoricoPorPrenda` — receta paraCosto × precios vigentes + procesos (bordado UNA vez, nulos→0).
 *  • `cantidadDeBase`   — elige la cantidad de la base de prorrateo (cortado/recibido/vendido).
 * El flujo con BD (guardar, rechazo de noCostear, unitario, lista) vive en `costo-orden.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';

import { cantidadDeBase } from './cantidades.js';
import { teoricoPorPrenda } from './costo-orden.js';

const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);
type OrdenArg = Parameters<typeof teoricoPorPrenda>[0];

/** Arma una orden mínima con la forma que `teoricoPorPrenda` necesita (cast controlado). */
function ordenFake(over: {
  maquilaOrd?: Prisma.Decimal | null;
  aplicacionOrd?: Prisma.Decimal | null;
  maquilaBase?: Prisma.Decimal | null;
  telas?: { consumoPorPrenda: Prisma.Decimal; precioSugerido: Prisma.Decimal | null }[];
  avios?: { consumoPorPrenda: Prisma.Decimal; precioReferencia: Prisma.Decimal | null }[];
  bordados?: { precio: Prisma.Decimal | null; catalogo: Prisma.Decimal | null }[];
}): OrdenArg {
  return {
    maquilaOrd: over.maquilaOrd ?? null,
    aplicacionOrd: over.aplicacionOrd ?? null,
    modelo: {
      maquilaBase: over.maquilaBase ?? null,
      telas: (over.telas ?? []).map((t) => ({
        consumoPorPrenda: t.consumoPorPrenda,
        tela: { precioSugerido: t.precioSugerido },
      })),
      avios: (over.avios ?? []).map((a) => ({
        consumoPorPrenda: a.consumoPorPrenda,
        avio: { precioReferencia: a.precioReferencia },
      })),
      bordados: (over.bordados ?? []).map((b) => ({
        precio: b.precio,
        bordado: { precio: b.catalogo },
      })),
    },
  } as unknown as OrdenArg;
}

describe('teoricoPorPrenda (receta paraCosto × precios + procesos)', () => {
  it('suma tela/avíos y arma procesos = maquilaOrd + aplicacionOrd + bordados', () => {
    const orden = ordenFake({
      maquilaOrd: D(10),
      aplicacionOrd: D(2),
      maquilaBase: D(99), // se IGNORA porque la orden trae maquilaOrd
      telas: [
        { consumoPorPrenda: D(1.5), precioSugerido: D(20) },
        { consumoPorPrenda: D(0.5), precioSugerido: null }, // precio nulo → 0
      ],
      avios: [{ consumoPorPrenda: D(2), precioReferencia: D(3) }],
      bordados: [
        { precio: D(5), catalogo: D(99) },
        { precio: null, catalogo: D(7) }, // sin precio en el modelo → cae al del catálogo
      ],
    });
    const t = teoricoPorPrenda(orden);
    expect(t.tela).toBeCloseTo(30, 6); // 1.5×20 + 0.5×0
    expect(t.avios).toBeCloseTo(6, 6); // 2×3
    expect(t.procesos).toBeCloseTo(24, 6); // 10 + 2 + (5 + 7)
  });

  it('el bordado entra UNA vez por modelo, SIN cantidad', () => {
    const orden = ordenFake({ bordados: [{ precio: D(15), catalogo: D(1) }] });
    // procesos = 0 (maquila) + 0 (aplicación) + 15 (bordado, sin multiplicar por cantidad).
    expect(teoricoPorPrenda(orden).procesos).toBeCloseTo(15, 6);
  });

  it('sin maquila de la orden usa la maquila base del modelo', () => {
    const orden = ordenFake({ maquilaOrd: null, maquilaBase: D(8) });
    expect(teoricoPorPrenda(orden).procesos).toBeCloseTo(8, 6);
  });

  it('todo nulo/vacío ⇒ 0 en los tres componentes (ceronulo)', () => {
    const t = teoricoPorPrenda(ordenFake({}));
    expect(t).toEqual({ tela: 0, avios: 0, procesos: 0 });
  });
});

describe('cantidadDeBase (base de prorrateo)', () => {
  const c = { pedido: 100, cortado: 80, recibido: 60, vendido: 40 };
  it('cortado (default) usa CantCorte', () => {
    expect(cantidadDeBase(c, 'cortado')).toBe(80);
  });
  it('recibido usa las piezas recibidas de costura', () => {
    expect(cantidadDeBase(c, 'recibido')).toBe(60);
  });
  it('vendido usa las piezas entregadas a cliente', () => {
    expect(cantidadDeBase(c, 'vendido')).toBe(40);
  });
});
