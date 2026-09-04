/**
 * Tests UNITARIOS de las fórmulas PURAS del costo de orden (F7-E1; D1/D2):
 *  • `teoricoPorPrenda` — receta paraCosto × precios vigentes + procesos (arte UNA vez, nulos→0).
 *  • `cantidadDeBase`   — elige la cantidad de la base de prorrateo (cortado/recibido/vendido).
 *  • `unitarioODeuda`   — el unitario, o el MOTIVO y la FRASE de por qué no lo hay (0.061).
 * El flujo con BD (guardar, rechazo de noCostear, unitario, lista) vive en `costo-orden.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';

import {
  BASE_PRORRATEO_DEFAULT,
  baseProrrateoAGuardar,
  cantidadDeBase,
  divisorCongelado,
  unitarioODeuda,
} from './cantidades.js';
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
  it('cortado usa CantCorte', () => {
    expect(cantidadDeBase(c, 'cortado')).toBe(80);
  });
  it('recibido usa las piezas recibidas de costura', () => {
    expect(cantidadDeBase(c, 'recibido')).toBe(60);
  });
  it('vendido usa las piezas entregadas a cliente', () => {
    expect(cantidadDeBase(c, 'vendido')).toBe(40);
  });
});

// ── 0.061 · El DIVISOR pasó a `recibido` y la división entre cero se REDACTA ────────────────────

describe('BASE_PRORRATEO_DEFAULT (0.061 — §Post-F9.154(b))', () => {
  it('es `recibido`, no `cortado`', () => {
    // DANIEL: las faltantes se le cobran al maquilero y las incompletas son merma; primeras y
    // segundas SÍ se venden ⇒ el divisor son las RECIBIDAS. Dividir entre las cortadas escondería
    // el costo de la merma.
    expect(BASE_PRORRATEO_DEFAULT).toBe('recibido');
  });

  it('el default apunta a las piezas RECIBIDAS de la orden, no a las cortadas', () => {
    // Amarra la constante con la aritmética: si alguien cambia una sin la otra, esto truena.
    const c = { pedido: 100, cortado: 80, recibido: 60, vendido: 40 };
    expect(cantidadDeBase(c, BASE_PRORRATEO_DEFAULT)).toBe(60);
  });
});

describe('unitarioODeuda (0.061): el unitario, o POR QUÉ no lo hay', () => {
  it('con base y costo, divide', () => {
    const u = unitarioODeuda(1200, 60, 'recibido', true);
    expect(u.costoUnitario).toBe(20);
    expect(u.motivoSinUnitario).toBeNull();
    expect(u.textoSinUnitario).toBeNull();
  });

  it('base en 0 ⇒ `sin-base` y la frase NOMBRA las piezas recibidas', () => {
    // Es el caso que nace con el divisor nuevo: hasta el primer recibo de costura la base es 0.
    const u = unitarioODeuda(1200, 0, 'recibido', true);
    expect(u.costoUnitario).toBeNull();
    expect(u.motivoSinUnitario).toBe('sin-base');
    expect(u.textoSinUnitario).toContain('piezas recibidas');
    expect(u.textoSinUnitario).toContain('recibo de costura');
  });

  it('la frase de `sin-base` habla de la base QUE SE USÓ, no siempre de recibidas', () => {
    expect(unitarioODeuda(10, 0, 'cortado', true).textoSinUnitario).toContain('piezas cortadas');
    expect(unitarioODeuda(10, 0, 'vendido', true).textoSinUnitario).toContain(
      'piezas entregadas al cliente',
    );
  });

  it('sin costo capturado ⇒ `sin-costo` (y NO se confunde con la base en 0)', () => {
    const u = unitarioODeuda(null, 60, 'recibido', true);
    expect(u.motivoSinUnitario).toBe('sin-costo');
    expect(u.textoSinUnitario).toContain('costo capturado');
  });

  it('la BASE EN CERO gana sobre la falta de costo (es lo que el usuario puede resolver)', () => {
    expect(unitarioODeuda(null, 0, 'recibido', true).motivoSinUnitario).toBe('sin-base');
  });

  it('sin `consultas.ver-importes` ⇒ `sin-importes`, y el motivo NO filtra dinero', () => {
    const u = unitarioODeuda(1200, 60, 'recibido', false);
    expect(u.costoUnitario).toBeNull();
    expect(u.motivoSinUnitario).toBe('sin-importes');
    expect(u.textoSinUnitario).not.toContain('1200');
  });

  it('una base NEGATIVA se trata como 0 (nunca produce un unitario negativo)', () => {
    // El histórico migrado puede dar restas negativas; el divisor jamás debe pasar de ahí.
    expect(unitarioODeuda(1200, -5, 'recibido', true).motivoSinUnitario).toBe('sin-base');
  });
});

// ── 0.061 · La base que se GUARDA: omitir CONSERVA, no pisa ────────────────────────────────────

describe('baseProrrateoAGuardar (0.061): omitir la base NO la pisa', () => {
  it('lo que manda el usuario gana', () => {
    expect(baseProrrateoAGuardar('vendido', 'cortado')).toBe('vendido');
  });

  it('⭐ OMITIRLA conserva la GUARDADA (el defecto que 0.061 cerró)', () => {
    // Hasta 0.061 el Zod traía `.default("cortado")`: un PUT que omitiera el campo reescribía la
    // base de una orden ya costeada y le cambiaba el unitario sin que nadie lo pidiera. Con el
    // default nuevo (`recibido`) eso habría reescrito el histórico — justo lo que la REGLA 0-B
    // prohíbe. Esta es la prueba de que ya no pasa.
    expect(baseProrrateoAGuardar(undefined, 'cortado')).toBe('cortado');
    expect(baseProrrateoAGuardar(undefined, 'vendido')).toBe('vendido');
  });

  it('en el PRIMER costeo (nada guardado) cae al default nuevo, `recibido`', () => {
    expect(baseProrrateoAGuardar(undefined, null)).toBe('recibido');
    expect(baseProrrateoAGuardar(undefined, undefined)).toBe(BASE_PRORRATEO_DEFAULT);
  });
});

// ── 0.061 · El corazón: cuándo el divisor está CONGELADO ────────────────────────────────────────

describe('divisorCongelado (0.061): el divisor de una orden CERRADA no se recalcula', () => {
  const CERRADA = { cerradaEn: new Date('2026-09-03T18:00:00.000Z') };
  const ABIERTA = { cerradaEn: null };
  const CONGELADO = {
    congeladoEn: new Date('2026-09-03T18:00:00.000Z'),
    cantidadBaseCongelada: 80,
  };

  it('⭐ cerrada + sellada ⇒ devuelve el divisor del cierre (y ya no se re-suma)', () => {
    expect(divisorCongelado(CERRADA, CONGELADO)).toBe(80);
  });

  it('ABIERTA ⇒ null aunque traiga un congelado viejo (el de un cierre ya reabierto)', () => {
    // D3: reabrir NO borra el congelado, lo MARCA. Si esto devolviera el número, una orden
    // reabierta seguiría enseñando el costo del cierre anterior — el costo NO volvería a lo vivo.
    expect(divisorCongelado(ABIERTA, CONGELADO)).toBeNull();
  });

  it('cerrada SIN fila de costo ⇒ null (un cierre no costea lo que no estaba costeado)', () => {
    expect(divisorCongelado(CERRADA, null)).toBeNull();
  });

  it('cerrada con costo pero SIN sello ⇒ null (no se inventa un divisor)', () => {
    expect(divisorCongelado(CERRADA, { congeladoEn: null, cantidadBaseCongelada: 80 })).toBeNull();
  });

  it('un divisor congelado en CERO se respeta como cero, no se confunde con "no hay"', () => {
    // Se cerró una orden sin recibos: el divisor congelado es 0 y el unitario quedó NULL. Si esto
    // devolviera null, la lectura volvería a re-sumar en vivo y el costo se descongelaría solo.
    expect(divisorCongelado(CERRADA, { ...CONGELADO, cantidadBaseCongelada: 0 })).toBe(0);
  });
});
