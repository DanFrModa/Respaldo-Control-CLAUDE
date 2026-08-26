/**
 * Tests UNITARIOS de la RESOLUCIÓN DE PRECIOS amarrados (F8-E1; R17/D13) y de la CASCADA ÚNICA de
 * V1-E3e (§Post-F9.48). Funciones PURAS: cubren la cascada de TELA (compra al amarrado → amarre-color
 * → amarre → última compra → color-referencia → sugerido) y la de AVÍO (compra al amarrado → amarre →
 * última compra → más barato → referencia), incluidos los bordes (sin nada, amarre sin precio).
 * El cuadre contra el pre-costo real de F7 vive en `pre-costo.test.ts`.
 *
 * ⭐ **NO-REGRESIÓN de V1-E3e:** los bloques de arriba llaman la cascada SIN los campos nuevos
 * (`ultimaCompra`/`ultimaCompraProveedorAmarrado`) y siguen esperando exactamente los mismos precios
 * y orígenes de antes. Es la prueba de que el escalón 1 solo entra cuando el llamador consultó el
 * histórico de compras, y de que nada cambia en su ausencia.
 */
import { describe, expect, it } from 'vitest';

import {
  resolverPrecioAvio,
  resolverPrecioAvioCatalogo,
  resolverPrecioColorReferencia,
  resolverPrecioTela,
} from './resolucion-precios.js';

describe('resolverPrecioTela (cascada de 4 pasos, R17)', () => {
  it('1) amarre CON color: usa TelaProveedorColor cuando el proveedor amarrado maneja color', () => {
    const r = resolverPrecioTela({
      precioSugerido: 100,
      precioColorReferencia: 90,
      amarre: { precio: 80, manejaPrecioPorColor: true, precioColor: 85 },
    });
    expect(r).toEqual({ precio: 85, origen: 'amarre-color', idProveedor: null });
  });

  it('2) amarre (base): si el proveedor amarrado NO maneja color, usa TelaProveedor.precio', () => {
    const r = resolverPrecioTela({
      precioSugerido: 100,
      precioColorReferencia: 90,
      amarre: { precio: 80, manejaPrecioPorColor: false, precioColor: 85 },
    });
    expect(r).toEqual({ precio: 80, origen: 'amarre', idProveedor: null });
  });

  it('2b) amarre maneja color PERO ese color no tiene precio → cae al precio base del amarre', () => {
    const r = resolverPrecioTela({
      precioSugerido: 100,
      precioColorReferencia: 90,
      amarre: { precio: 80, manejaPrecioPorColor: true, precioColor: null },
    });
    expect(r).toEqual({ precio: 80, origen: 'amarre', idProveedor: null });
  });

  it('3) referencia por color: sin amarre, usa TelaColor.precio del color en contexto', () => {
    const r = resolverPrecioTela({ precioSugerido: 100, precioColorReferencia: 90, amarre: null });
    expect(r).toEqual({ precio: 90, origen: 'color-referencia', idProveedor: null });
  });

  it('3b) amarre presente pero SIN precio base ni color → cae a la referencia por color', () => {
    const r = resolverPrecioTela({
      precioSugerido: 100,
      precioColorReferencia: 90,
      amarre: { precio: null, manejaPrecioPorColor: true, precioColor: null },
    });
    expect(r).toEqual({ precio: 90, origen: 'color-referencia', idProveedor: null });
  });

  it('4) sugerido: sin amarre ni referencia por color, usa Tela.precioSugerido (el de F7)', () => {
    const r = resolverPrecioTela({ precioSugerido: 100 });
    expect(r).toEqual({ precio: 100, origen: 'sugerido', idProveedor: null });
  });

  it('sin NADA en ningún escalón → precio null, origen sin-precio (no truena)', () => {
    const r = resolverPrecioTela({ precioSugerido: null });
    expect(r).toEqual({ precio: null, origen: 'sin-precio', idProveedor: null });
  });

  it('un precio de 0 es válido (una tela regalada), no se salta como si fuera nulo', () => {
    const r = resolverPrecioTela({
      precioSugerido: 100,
      amarre: { precio: 0, manejaPrecioPorColor: false },
    });
    expect(r).toEqual({ precio: 0, origen: 'amarre', idProveedor: null });
  });
});

describe('resolverPrecioAvio (cascada de 3 pasos, R17)', () => {
  it('1) amarre: usa el proveedor amarrado AUNQUE haya uno más barato', () => {
    const r = resolverPrecioAvio({
      precioReferencia: 10,
      idAvioProveedor: 2,
      proveedores: [
        { idProveedor: 1, precio: 100 }, // más barato, pero NO amarrado
        { idProveedor: 2, precio: 500 }, // amarrado → gana
      ],
    });
    expect(r).toEqual({ precio: 500, origen: 'amarre', idProveedor: 2 });
  });

  it('2) más barato: sin amarre, elige el menor precio', () => {
    const r = resolverPrecioAvio({
      precioReferencia: 10,
      proveedores: [
        { idProveedor: 1, precio: 500 },
        { idProveedor: 2, precio: 300 }, // más barato
      ],
    });
    expect(r).toEqual({ precio: 300, origen: 'mas-barato', idProveedor: 2 });
  });

  it('amarre presente pero el proveedor amarrado no tiene precio → cae a "más barato"', () => {
    const r = resolverPrecioAvio({
      precioReferencia: 10,
      idAvioProveedor: 1,
      proveedores: [
        { idProveedor: 1, precio: null }, // amarrado, sin precio
        { idProveedor: 2, precio: 4 }, // gana por defecto
      ],
    });
    expect(r).toEqual({ precio: 4, origen: 'mas-barato', idProveedor: 2 });
  });

  it('3) referencia: sin proveedores con precio, usa Avio.precioReferencia', () => {
    const r = resolverPrecioAvio({
      precioReferencia: 12,
      proveedores: [{ idProveedor: 1, precio: null }],
    });
    expect(r).toEqual({ precio: 12, origen: 'referencia', idProveedor: null });
  });

  it('sin proveedores ni referencia → precio null, origen sin-precio', () => {
    const r = resolverPrecioAvio({
      precioReferencia: null,
      proveedores: [],
    });
    expect(r).toEqual({ precio: null, origen: 'sin-precio', idProveedor: null });
  });

  // ⭐ §Post-F9.97 — LA REGLA: `AvioProveedor.precio` YA está en unidad de consumo, así que la
  // cascada lo devuelve TAL CUAL. Hasta V1-E8a lo dividía entre un «factor de conversión»
  // presentación→consumo; el factor se retiró y esta prueba es la que impide que vuelva: si
  // alguien reintroduce una división aquí, este número deja de ser 7.5.
  it('el precio del proveedor ES el costo por unidad de consumo — no se divide por nada', () => {
    const r = resolverPrecioAvio({
      precioReferencia: null,
      proveedores: [{ idProveedor: 3, precio: 7.5 }],
    });
    expect(r.precio).toBe(7.5);
    expect(r.origen).toBe('mas-barato');
  });
});

describe('resolverPrecioColorReferencia (colores HIJOS de la tela, §Post-F9.11)', () => {
  const colores = [
    { nombre: 'Negro', precio: 90, idColor: 7 }, // migrada: liga legacy al color de prenda 7
    { nombre: 'Blanco', precio: 80, idColor: null }, // nueva: sin liga, pega por nombre
    { nombre: 'Rojo', precio: null, idColor: 9 }, // ligada pero sin precio
  ];

  it('1) resuelve PRIMERO por la liga legacy idColor (lo migrado sigue igual)', () => {
    // El nombre del contexto NI coincide ("NEGRO AZABACHE"): la liga manda.
    expect(resolverPrecioColorReferencia(colores, { idColor: 7, nombre: 'NEGRO AZABACHE' })).toBe(
      90,
    );
  });

  it('2) sin liga que pegue, resuelve por NOMBRE insensible a mayúsculas', () => {
    expect(resolverPrecioColorReferencia(colores, { idColor: 999, nombre: ' BLANCO ' })).toBe(80);
  });

  // Caso DISCRIMINANTE del orden (R2-4): la liga Y el nombre pegan a la vez pero en filas
  // DISTINTAS con precios distintos — la LIGA legacy (90) manda sobre el nombre (80). Si
  // alguien invirtiera los bloques, esta prueba daría 80 y moriría.
  it('cuando liga y nombre pegan en filas distintas, GANA la liga legacy', () => {
    expect(resolverPrecioColorReferencia(colores, { idColor: 7, nombre: 'Blanco' })).toBe(90);
  });

  it('liga que pega pero SIN precio usable cae al pegue por nombre (y luego a null)', () => {
    // idColor 9 pega (Rojo) pero su precio es null → por nombre también es Rojo → null.
    expect(resolverPrecioColorReferencia(colores, { idColor: 9, nombre: 'Rojo' })).toBeNull();
  });

  it('3) sin liga NI nombre que peguen devuelve null (la cascada cae al sugerido)', () => {
    expect(resolverPrecioColorReferencia(colores, { idColor: 999, nombre: 'Verde' })).toBeNull();
    // Y enchufado a la cascada completa: cae al precioSugerido.
    expect(
      resolverPrecioTela({
        precioSugerido: 42,
        precioColorReferencia: resolverPrecioColorReferencia(colores, {
          idColor: 999,
          nombre: 'Verde',
        }),
      }),
    ).toEqual({ precio: 42, origen: 'sugerido', idProveedor: null });
  });
});

describe('resolverPrecioAvioCatalogo (regla COMPARTIDA precosto ↔ receta, V1-E3c)', () => {
  const proveedores = [
    { idProveedor: 1, precio: 10 }, // $10 por unidad de consumo (§Post-F9.97: la única unidad)
    { idProveedor: 2, precio: 8 }, // $8
  ];

  it('sin medidas se comporta EXACTAMENTE como la cascada (amarre → más barato → referencia)', () => {
    const entrada = { precioReferencia: 3, proveedores, medidas: [] };
    expect(resolverPrecioAvioCatalogo({ ...entrada, idAvioProveedor: 1 })).toEqual(
      resolverPrecioAvio({ ...entrada, idAvioProveedor: 1 }),
    );
    // Sin amarre: el MÁS BARATO (8), NO el precioReferencia del catálogo (3).
    expect(resolverPrecioAvioCatalogo(entrada)).toEqual({
      precio: 8,
      origen: 'mas-barato',
      idProveedor: 2,
    });
  });

  it('un avío POR MEDIDA se costea con el promedio de sus medidas, y eso GANA al amarre', () => {
    const resuelto = resolverPrecioAvioCatalogo({
      precioReferencia: 3,
      proveedores,
      idAvioProveedor: 1,
      medidas: [5.8, 6.2],
    });
    expect(resuelto).toEqual({ precio: 6, origen: 'promedio-medidas', idProveedor: null });
  });

  it('sin proveedores con precio cae al precioReferencia del catálogo (último recurso)', () => {
    expect(
      resolverPrecioAvioCatalogo({
        precioReferencia: 3,
        proveedores: [{ idProveedor: 1, precio: null }],
        medidas: [],
      }),
    ).toEqual({ precio: 3, origen: 'referencia', idProveedor: null });
  });

  it('sin nada devuelve sin-precio (el costeo lo tomaría como 0)', () => {
    expect(
      resolverPrecioAvioCatalogo({
        precioReferencia: null,
        proveedores: [],
        medidas: [],
      }),
    ).toEqual({ precio: null, origen: 'sin-precio', idProveedor: null });
  });
});

// ── V1-E3e · UN SOLO COSTO: manda el precio REAL de compra (§Post-F9.48) ──────────────────────────

describe('escalón 1 — el ÚLTIMO PRECIO DE COMPRA REAL (§Post-F9.48)', () => {
  describe('tela', () => {
    it('sin amarre: la última compra REAL manda sobre color-referencia y sobre el sugerido', () => {
      const r = resolverPrecioTela({
        precioSugerido: 100,
        precioColorReferencia: 90,
        ultimaCompra: { precio: 73.5, idProveedor: 4 },
      });
      expect(r).toEqual({ precio: 73.5, origen: 'ultimo-precio-compra', idProveedor: 4 });
    });

    it('⭐ con amarre: el amarre elige el PROVEEDOR y el precio es el de la última compra A ÉL', () => {
      const r = resolverPrecioTela({
        precioSugerido: 100,
        amarre: { precio: 80, manejaPrecioPorColor: true, precioColor: 85 },
        // La compra más reciente del material fue a OTRO proveedor ($50): NO se usa, porque el
        // amarre manda sobre a quién se le compra.
        ultimaCompra: { precio: 50, idProveedor: 9 },
        ultimaCompraProveedorAmarrado: { precio: 82, idProveedor: 3 },
      });
      expect(r).toEqual({ precio: 82, origen: 'ultimo-precio-compra', idProveedor: 3 });
    });

    it('al proveedor amarrado NUNCA se le ha comprado → su precio NEGOCIADO (escalón 2)', () => {
      const r = resolverPrecioTela({
        precioSugerido: 100,
        amarre: { precio: 80, manejaPrecioPorColor: false },
        ultimaCompra: { precio: 50, idProveedor: 9 },
        ultimaCompraProveedorAmarrado: null,
      });
      expect(r).toEqual({ precio: 80, origen: 'amarre', idProveedor: null });
    });

    it('amarre sin compra Y sin precio → sigue la cascada general (última compra a cualquiera)', () => {
      const r = resolverPrecioTela({
        precioSugerido: 100,
        precioColorReferencia: 90,
        amarre: { precio: null, manejaPrecioPorColor: false },
        ultimaCompra: { precio: 50, idProveedor: 9 },
      });
      expect(r).toEqual({ precio: 50, origen: 'ultimo-precio-compra', idProveedor: 9 });
    });

    it('material NUEVO (nunca comprado, sin proveedor) → referencia, que es su único caso', () => {
      const r = resolverPrecioTela({ precioSugerido: 100, ultimaCompra: null });
      expect(r).toEqual({ precio: 100, origen: 'sugerido', idProveedor: null });
    });
  });

  describe('avío', () => {
    const proveedores = [
      { idProveedor: 1, precio: 10 }, // $10 por unidad de consumo (§Post-F9.97: la única unidad)
      { idProveedor: 2, precio: 8 }, // $8 (el más barato del catálogo)
    ];

    it('sin amarre: la última compra REAL gana al "más barato" y a la referencia', () => {
      const r = resolverPrecioAvio({
        precioReferencia: 3,
        proveedores,
        ultimaCompra: { precio: 11.25, idProveedor: 1 },
      });
      expect(r).toEqual({ precio: 11.25, origen: 'ultimo-precio-compra', idProveedor: 1 });
    });

    it('⭐ con amarre: manda la última compra AL PROVEEDOR AMARRADO, no la más reciente global', () => {
      const r = resolverPrecioAvio({
        precioReferencia: 3,
        proveedores,
        idAvioProveedor: 1,
        ultimaCompra: { precio: 6, idProveedor: 2 },
        ultimaCompraProveedorAmarrado: { precio: 12, idProveedor: 1 },
      });
      expect(r).toEqual({ precio: 12, origen: 'ultimo-precio-compra', idProveedor: 1 });
    });

    it('al amarrado nunca se le compró → su precio de catálogo (aunque haya uno más barato)', () => {
      const r = resolverPrecioAvio({
        precioReferencia: 3,
        proveedores,
        idAvioProveedor: 1,
        ultimaCompra: { precio: 6, idProveedor: 2 },
        ultimaCompraProveedorAmarrado: null,
      });
      expect(r).toEqual({ precio: 10, origen: 'amarre', idProveedor: 1 });
    });

    it('amarre sin compra Y sin precio → cae a la última compra global antes que a "más barato"', () => {
      const r = resolverPrecioAvio({
        precioReferencia: 3,
        proveedores: [
          { idProveedor: 1, precio: null }, // amarrado, sin precio
          { idProveedor: 2, precio: 4 },
        ],
        idAvioProveedor: 1,
        ultimaCompra: { precio: 6, idProveedor: 2 },
      });
      expect(r).toEqual({ precio: 6, origen: 'ultimo-precio-compra', idProveedor: 2 });
    });

    it('un precio de compra en CERO es válido y no se salta (regalo/muestra)', () => {
      const r = resolverPrecioAvio({
        precioReferencia: 3,
        proveedores,
        ultimaCompra: { precio: 0, idProveedor: 2 },
      });
      expect(r).toEqual({ precio: 0, origen: 'ultimo-precio-compra', idProveedor: 2 });
    });

    it('el PROMEDIO DE MEDIDAS sigue GANANDO al último precio de compra (decisión de V1-E3e)', () => {
      // Una línea de OC se liga al AVÍO, no a la medida: su precio es el de UNA medida y no
      // representa a las demás. Si esto se invirtiera, un elástico de 5 anchos se cotizaría todo
      // al ancho que se compró la última vez.
      const r = resolverPrecioAvioCatalogo({
        precioReferencia: 3,
        proveedores,
        idAvioProveedor: 1,
        medidas: [5.8, 6.2],
        ultimaCompra: { precio: 30, idProveedor: 2 },
        ultimaCompraProveedorAmarrado: { precio: 40, idProveedor: 1 },
      });
      expect(r).toEqual({ precio: 6, origen: 'promedio-medidas', idProveedor: null });
    });
  });

  describe('NO-REGRESIÓN: sin datos de compra, la cascada es la de antes de V1-E3e', () => {
    it('tela: pasar los campos nuevos en null da EXACTAMENTE el mismo resultado que omitirlos', () => {
      const base = {
        precioSugerido: 100,
        precioColorReferencia: 90,
        amarre: { precio: 80, manejaPrecioPorColor: false },
      };
      expect(
        resolverPrecioTela({ ...base, ultimaCompra: null, ultimaCompraProveedorAmarrado: null }),
      ).toEqual(resolverPrecioTela(base));
    });

    it('avío: pasar los campos nuevos en null da EXACTAMENTE el mismo resultado que omitirlos', () => {
      const base = {
        precioReferencia: 3,
        idAvioProveedor: 2,
        proveedores: [
          { idProveedor: 1, precio: 500 },
          { idProveedor: 2, precio: 8 },
        ],
      };
      expect(
        resolverPrecioAvio({ ...base, ultimaCompra: null, ultimaCompraProveedorAmarrado: null }),
      ).toEqual(resolverPrecioAvio(base));
    });
  });
});
