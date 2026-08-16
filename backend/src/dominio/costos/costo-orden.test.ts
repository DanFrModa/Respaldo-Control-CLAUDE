/**
 * Tests UNITARIOS de las fórmulas PURAS del costo de orden (F7-E1; D1/D2):
 *  • `teoricoPorPrenda` — receta paraCosto × precios vigentes + procesos (arte UNA vez, nulos→0).
 *  • `cantidadDeBase`   — elige la cantidad de la base de prorrateo (cortado/recibido/vendido).
 * El flujo con BD (guardar, rechazo de noCostear, unitario, lista) vive en `costo-orden.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';

import { cantidadDeBase } from './cantidades.js';
import { teoricoPorPrenda } from './costo-orden.js';

const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);
type OrdenArg = Parameters<typeof teoricoPorPrenda>[0];

/**
 * Arma una orden mínima con la forma que `teoricoPorPrenda` necesita (cast controlado).
 *
 * V1-E3d: la receta es de la ORDEN (`recetaTelas`/`recetaAvios`/`recetaArtes`). Cada renglón trae
 * su `precio` CONGELADO; cuando es `null` (recetas anteriores a la etapa) el costeo cae al precio
 * de catálogo, que es lo que estas pruebas ejercitan pasando solo `precioSugerido`/`precioReferencia`.
 */
function ordenFake(over: {
  maquilaOrd?: Prisma.Decimal | null;
  aplicacionOrd?: Prisma.Decimal | null;
  maquilaBase?: Prisma.Decimal | null;
  telas?: {
    consumoPorPrenda: Prisma.Decimal;
    precioSugerido: Prisma.Decimal | null;
    precio?: Prisma.Decimal | null;
  }[];
  avios?: {
    consumoPorPrenda: Prisma.Decimal;
    precioReferencia: Prisma.Decimal | null;
    precio?: Prisma.Decimal | null;
  }[];
  artes?: { precio: Prisma.Decimal | null }[];
}): OrdenArg {
  return {
    maquilaOrd: over.maquilaOrd ?? null,
    aplicacionOrd: over.aplicacionOrd ?? null,
    modelo: { maquilaBase: over.maquilaBase ?? null },
    recetaTelas: (over.telas ?? []).map((t) => ({
      consumoPorPrenda: t.consumoPorPrenda,
      precio: t.precio ?? null,
      tela: { precioSugerido: t.precioSugerido },
    })),
    recetaAvios: (over.avios ?? []).map((a) => ({
      consumoPorPrenda: a.consumoPorPrenda,
      precio: a.precio ?? null,
      avio: { precioReferencia: a.precioReferencia },
    })),
    recetaArtes: (over.artes ?? []).map((a) => ({ precio: a.precio })),
  } as unknown as OrdenArg;
}

describe('teoricoPorPrenda (receta paraCosto × precios + procesos)', () => {
  it('suma tela/avíos y arma procesos = maquilaOrd + aplicacionOrd + arte', () => {
    const orden = ordenFake({
      maquilaOrd: D(10),
      aplicacionOrd: D(2),
      maquilaBase: D(99), // se IGNORA porque la orden trae maquilaOrd
      telas: [
        { consumoPorPrenda: D(1.5), precioSugerido: D(20) },
        { consumoPorPrenda: D(0.5), precioSugerido: null }, // precio nulo → 0
      ],
      avios: [{ consumoPorPrenda: D(2), precioReferencia: D(3) }],
      artes: [{ precio: D(5) }, { precio: D(7) }],
    });
    const t = teoricoPorPrenda(orden);
    expect(t.tela).toBeCloseTo(30, 6); // 1.5×20 + 0.5×0
    expect(t.avios).toBeCloseTo(6, 6); // 2×3
    expect(t.procesos).toBeCloseTo(24, 6); // 10 + 2 + (5 + 7)
  });

  it('el arte entra UNA vez por modelo, SIN cantidad', () => {
    const orden = ordenFake({ artes: [{ precio: D(15) }] });
    // procesos = 0 (maquila) + 0 (aplicación) + 15 (arte, sin multiplicar por cantidad).
    expect(teoricoPorPrenda(orden).procesos).toBeCloseTo(15, 6);
  });

  it('un arte SIN precio (histórico migrado) cuenta 0, no rompe (ceronulo)', () => {
    const orden = ordenFake({ artes: [{ precio: null }, { precio: D(4) }] });
    expect(teoricoPorPrenda(orden).procesos).toBeCloseTo(4, 6);
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

/**
 * ⭐ V1-E3d pieza B (§Post-F9.43): **el precio CONGELADO en la orden manda sobre el del catálogo**,
 * y su ausencia (`null`) NO es un precio: cae al catálogo. Ese fallback es lo que hace que las
 * ~4,000 órdenes backfilleadas por la migración —que no congelaron precio— costeen EXACTAMENTE
 * igual que antes de la etapa, mientras las nuevas costean con el suyo.
 */
describe('V1-E3d — el precio congelado en la OP manda; `null` cae al catálogo', () => {
  it('con precio congelado, el catálogo NO manda (aunque sea distinto)', () => {
    const t = teoricoPorPrenda(
      ordenFake({
        telas: [{ consumoPorPrenda: D(2), precioSugerido: D(100), precio: D(30) }],
        avios: [{ consumoPorPrenda: D(3), precioReferencia: D(9), precio: D(1) }],
      }),
    );
    expect(t.tela).toBeCloseTo(60, 6); // 2 × 30 (congelado), NO 2 × 100
    expect(t.avios).toBeCloseTo(3, 6); // 3 × 1 (congelado), NO 3 × 9
  });

  it('SIN precio congelado (null) cae al catálogo — no-regresión del histórico', () => {
    const t = teoricoPorPrenda(
      ordenFake({
        telas: [{ consumoPorPrenda: D(2), precioSugerido: D(100), precio: null }],
        avios: [{ consumoPorPrenda: D(3), precioReferencia: D(9), precio: null }],
      }),
    );
    expect(t.tela).toBeCloseTo(200, 6);
    expect(t.avios).toBeCloseTo(27, 6);
  });

  it('un precio congelado en 0 NO cae al catálogo (0 es un precio, no "sin precio")', () => {
    const t = teoricoPorPrenda(
      ordenFake({ telas: [{ consumoPorPrenda: D(2), precioSugerido: D(100), precio: D(0) }] }),
    );
    expect(t.tela).toBe(0);
  });

  it('⭐ criterio de cierre: dos órdenes del MISMO modelo cuestan distinto', () => {
    // Misma tela y mismo avío base; la orden B le quitó la jareta (su renglón no está en la receta)
    // y además congeló otro precio de tela. Ninguna sabe de la otra.
    const conJareta = teoricoPorPrenda(
      ordenFake({
        telas: [{ consumoPorPrenda: D(1), precioSugerido: D(50), precio: D(50) }],
        avios: [
          { consumoPorPrenda: D(1), precioReferencia: D(2), precio: D(2) },
          { consumoPorPrenda: D(1), precioReferencia: D(8), precio: D(8) }, // la jareta
        ],
      }),
    );
    const sinJareta = teoricoPorPrenda(
      ordenFake({
        telas: [{ consumoPorPrenda: D(1), precioSugerido: D(50), precio: D(45) }],
        avios: [{ consumoPorPrenda: D(1), precioReferencia: D(2), precio: D(2) }],
      }),
    );
    expect(conJareta.avios).toBeCloseTo(10, 6);
    expect(sinJareta.avios).toBeCloseTo(2, 6);
    expect(conJareta.tela).toBeCloseTo(50, 6);
    expect(sinJareta.tela).toBeCloseTo(45, 6);
  });
});

/**
 * ⚠️ LA INVARIANTE DE V1-E3d (§Post-F9.35): mover el arte al modelo NO puede mover el costeo.
 *
 * ANTES el precio del arte se resolvía con una CASCADA de dos niveles —
 * `ModeloBordado.precio ?? Bordado.precio` (el del renglón del BOM, o el del catálogo si el
 * renglón venía vacío)—. Al desaparecer el catálogo queda UN solo precio: el que la migración
 * copió resolviendo esa misma cascada (`COALESCE(mb.precio, b.precio)` en
 * `20260814120000_arte_en_el_modelo/migration.sql`).
 *
 * Esta prueba lo DEMUESTRA en vez de afirmarlo: reimplementa la fórmula VIEJA tal como estaba
 * escrita, aplica la resolución de la migración sobre los MISMOS datos, y exige que
 * `teoricoPorPrenda` (que ya lee un solo precio) dé exactamente el mismo número — para todas las
 * combinaciones de renglón/catálogo que existían, incluidas las de precio nulo.
 */
describe('V1-E3d — el costeo NO se mueve al sacar el arte del catálogo', () => {
  /** Un renglón del BOM viejo: su precio y el del catálogo detrás. */
  type ArteViejo = { precioRenglon: number | null; precioCatalogo: number | null };

  /** La fórmula VIEJA, tal cual estaba en `costo-orden.ts` antes de V1-E3d. */
  function arteViejo(artes: ArteViejo[]): number {
    return artes.reduce(
      (s, a) => s + (a.precioRenglon === null ? (a.precioCatalogo ?? 0) : a.precioRenglon),
      0,
    );
  }

  /** Lo que hizo la migración con cada renglón: `COALESCE(mb.precio, b.precio)`. */
  function migrado(a: ArteViejo): { precio: Prisma.Decimal | null } {
    const resuelto = a.precioRenglon ?? a.precioCatalogo;
    return { precio: resuelto === null ? null : D(resuelto) };
  }

  const casos: { titulo: string; artes: ArteViejo[] }[] = [
    {
      titulo: 'precio en el renglón (el catálogo no manda)',
      artes: [{ precioRenglon: 12.5, precioCatalogo: 99 }],
    },
    {
      titulo: 'renglón vacío → caía al catálogo',
      artes: [{ precioRenglon: null, precioCatalogo: 7.25 }],
    },
    {
      titulo: 'renglón y catálogo vacíos → 0',
      artes: [{ precioRenglon: null, precioCatalogo: null }],
    },
    {
      titulo: 'renglón en 0 NO cae al catálogo (0 es un precio)',
      artes: [{ precioRenglon: 0, precioCatalogo: 30 }],
    },
    {
      titulo: 'varios artes del mismo modelo, mezclando los tres casos',
      artes: [
        { precioRenglon: 5, precioCatalogo: 99 },
        { precioRenglon: null, precioCatalogo: 7 },
        { precioRenglon: null, precioCatalogo: null },
      ],
    },
  ];

  for (const caso of casos) {
    it(`da el mismo importe que la fórmula vieja: ${caso.titulo}`, () => {
      const orden = ordenFake({
        maquilaOrd: D(10),
        aplicacionOrd: D(2),
        artes: caso.artes.map(migrado),
      });
      const esperadoViejo = 10 + 2 + arteViejo(caso.artes);
      expect(teoricoPorPrenda(orden).procesos).toBeCloseTo(esperadoViejo, 6);
    });
  }

  it('el arte sigue entrando UNA vez por modelo (no se multiplica por cantidad)', () => {
    // La cantidad de la orden no aparece en la fórmula: 3 artes = Σ de sus 3 precios, punto.
    const artes: ArteViejo[] = [
      { precioRenglon: 3, precioCatalogo: null },
      { precioRenglon: null, precioCatalogo: 4 },
      { precioRenglon: 5, precioCatalogo: 6 },
    ];
    const orden = ordenFake({ artes: artes.map(migrado) });
    expect(teoricoPorPrenda(orden).procesos).toBeCloseTo(arteViejo(artes), 6);
    expect(teoricoPorPrenda(orden).procesos).toBeCloseTo(12, 6);
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
