/**
 * Tests UNITARIOS del núcleo PURO del COSTO REAL DE MATERIALES desde las órdenes de compra
 * (petición de Daniel, 26-jul-2026 — `DECISIONES.md` §Post-F9.5): `combinarCostoReal`.
 *
 * Cubren las tres reglas de Daniel y sus bordes:
 *  • manda lo COMPRADO (atribución directa de las líneas de OC ligadas a la orden),
 *  • los GENÉRICOS (y todo consumo sin compra propia) se valúan a ÚLTIMO PRECIO DE COMPRA,
 *  • una compra que surte a varias órdenes se PRORRATEA de facto (cada orden se lleva su consumo).
 * Más: mezcla directo+valuado, sobre-compra, material nunca comprado (catálogo), material sin
 * precio, compras LIBRES y compras de material fuera del requerido.
 *
 * El filtrado por estatus de la OC (borrador/cancelada fuera) y por empresa (A9) es de BASE DE
 * DATOS: vive en `costo-real-compras.int.test.ts` (lo corre CI).
 */
import { describe, expect, it } from 'vitest';

import {
  combinarCostoReal,
  type LineaCompraLigada,
  type ReferenciaCompra,
  type RequeridoMaterial,
} from './costo-real-compras.js';

/** Referencia de OC de juguete. */
function compra(numCompra: number, proveedor = 'Proveedor A'): ReferenciaCompra {
  return {
    idOrdenCompra: numCompra,
    numCompra,
    estatus: 'autorizada',
    fecha: '2026-07-01',
    idProveedor: 1,
    proveedor,
  };
}

/** Un material requerido (tela por defecto), con los precios ya resueltos por el lector de BD. */
function requerido(over: Partial<RequeridoMaterial> & { clave: string }): RequeridoMaterial {
  return {
    tipo: 'tela',
    idTela: 1,
    idAvio: null,
    material: 'Tela X',
    unidad: 'm',
    esGenerico: false,
    requerido: 0,
    ultimoPrecio: null,
    ultimaCompra: null,
    precioCatalogo: null,
    ...over,
  };
}

/** Una línea de OC ligada a la orden. */
function ligada(over: Partial<LineaCompraLigada> & { clave: string }): LineaCompraLigada {
  const cantidad = over.cantidad ?? 0;
  return {
    tipo: 'tela',
    idTela: 1,
    idAvio: null,
    material: 'Tela X',
    cantidad,
    cantidadConsumo: over.cantidadConsumo ?? cantidad,
    unidad: 'm',
    precio: 0,
    compra: compra(100),
    ...over,
  };
}

describe('combinarCostoReal — regla 1: manda lo COMPRADO (OC autorizada ligada a la orden)', () => {
  it('atribuye la compra directa y no valúa nada cuando cubre el consumo', () => {
    const r = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 100, precioCatalogo: 20, ultimoPrecio: 19 })],
      [ligada({ clave: 'tela-1', cantidad: 100, precio: 23.5, compra: compra(4001) })],
    );

    expect(r.hayCompras).toBe(true);
    expect(r.tela).toBe(2350);
    expect(r.avios).toBe(0);
    expect(r.total).toBe(2350);
    expect(r.importeDirecto).toBe(2350);
    expect(r.importeValuado).toBe(0);
    const [m] = r.materiales;
    expect(m?.origenPrecio).toBe('compra-directa');
    expect(m?.cantidadValuada).toBe(0);
    // Trazabilidad: de qué OC y de qué proveedor salió el número.
    expect(m?.compras).toHaveLength(1);
    expect(m?.compras[0]?.numCompra).toBe(4001);
    expect(m?.compras[0]?.importe).toBe(2350);
    expect(r.avisos).toEqual([]);
  });

  it('el precio comprado MANDA sobre el de catálogo (que es lo que Daniel quería corregir)', () => {
    const catalogo = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 100, precioCatalogo: 20 })],
      [],
    );
    const comprado = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 100, precioCatalogo: 20 })],
      [ligada({ clave: 'tela-1', cantidad: 100, precio: 31 })],
    );
    expect(catalogo.tela).toBe(2000); // receta × catálogo (el mundo viejo)
    expect(comprado.tela).toBe(3100); // lo realmente comprado (el mundo nuevo)
  });

  it('suma VARIAS líneas de OC del mismo material y conserva la traza de cada una', () => {
    const r = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 150 })],
      [
        ligada({ clave: 'tela-1', cantidad: 100, precio: 10, compra: compra(1, 'Textiles SA') }),
        ligada({ clave: 'tela-1', cantidad: 50, precio: 12, compra: compra(2, 'Telas MX') }),
      ],
    );
    expect(r.tela).toBe(1600);
    expect(r.materiales[0]?.compras.map((c) => c.proveedor)).toEqual(['Textiles SA', 'Telas MX']);
  });

  it('la SOBRE-compra (se compró más de lo requerido) entra completa y no deja nada por valuar', () => {
    const r = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 100, ultimoPrecio: 10 })],
      [ligada({ clave: 'tela-1', cantidad: 130, precio: 10 })],
    );
    expect(r.tela).toBe(1300);
    expect(r.materiales[0]?.cantidadValuada).toBe(0);
    expect(r.importeValuado).toBe(0);
  });
});

describe('combinarCostoReal — regla 2: los genéricos se valúan a ÚLTIMO PRECIO DE COMPRA', () => {
  it('valúa el avío genérico sin compra propia al último precio, con su traza', () => {
    const r = combinarCostoReal(
      [
        requerido({
          clave: 'avio-9',
          tipo: 'avio',
          idTela: null,
          idAvio: 9,
          material: 'HIL-01 — Hilo',
          unidad: 'pza',
          esGenerico: true,
          requerido: 500,
          ultimoPrecio: 1.25,
          ultimaCompra: compra(3300, 'Hilos del Norte'),
          precioCatalogo: 2,
        }),
      ],
      [],
    );

    expect(r.hayCompras).toBe(false);
    expect(r.avios).toBe(625);
    expect(r.tela).toBe(0);
    expect(r.importeValuado).toBe(625);
    const [m] = r.materiales;
    expect(m?.origenPrecio).toBe('ultimo-precio-compra');
    expect(m?.precioValuado).toBe(1.25);
    expect(m?.ultimaCompra?.numCompra).toBe(3300);
    expect(m?.ultimaCompra?.proveedor).toBe('Hilos del Norte');
    expect(r.avisos).toEqual([]);
  });

  it('el último precio de compra GANA al precio de catálogo', () => {
    const r = combinarCostoReal(
      [
        requerido({
          clave: 'avio-9',
          tipo: 'avio',
          idTela: null,
          idAvio: 9,
          requerido: 100,
          ultimoPrecio: 3,
          precioCatalogo: 7,
        }),
      ],
      [],
    );
    expect(r.avios).toBe(300);
  });
});

describe('combinarCostoReal — regla 3: la compra compartida se PRORRATEA por consumo', () => {
  it('dos órdenes con consumos distintos se llevan cada una su parte del mismo precio', () => {
    // Una compra grande SIN `idOrden` (surte a varias órdenes) queda como "último precio de compra":
    // cada orden se valúa por lo que consume → el reparto es proporcional al consumo.
    const precioCompraGrande = 4;
    const ordenA = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 300, ultimoPrecio: precioCompraGrande })],
      [],
    );
    const ordenB = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 700, ultimoPrecio: precioCompraGrande })],
      [],
    );
    expect(ordenA.tela).toBe(1200);
    expect(ordenB.tela).toBe(2800);
    // El total repartido es exactamente el de la compra de 1,000 unidades a $4.
    expect(ordenA.tela + ordenB.tela).toBe(1000 * precioCompraGrande);
  });
});

describe('combinarCostoReal — mezcla de directo y valuado', () => {
  it('compra parcial: lo comprado a su precio y el resto a último precio de compra', () => {
    const r = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 100, ultimoPrecio: 8, precioCatalogo: 20 })],
      [ligada({ clave: 'tela-1', cantidad: 60, precio: 10 })],
    );
    expect(r.importeDirecto).toBe(600); // 60 × 10
    expect(r.importeValuado).toBe(320); // 40 × 8
    expect(r.tela).toBe(920);
    const [m] = r.materiales;
    expect(m?.comprado).toBe(60);
    expect(m?.cantidadValuada).toBe(40);
    expect(m?.origenPrecio).toBe('ultimo-precio-compra');
  });

  it('separa TELA de AVÍOS (son componentes distintos del costo de la orden)', () => {
    const r = combinarCostoReal(
      [
        requerido({ clave: 'tela-1', requerido: 100, ultimoPrecio: 5 }),
        requerido({
          clave: 'avio-2',
          tipo: 'avio',
          idTela: null,
          idAvio: 2,
          requerido: 200,
          ultimoPrecio: 1.5,
        }),
      ],
      [ligada({ clave: 'tela-1', cantidad: 100, precio: 6 })],
    );
    expect(r.tela).toBe(600);
    expect(r.avios).toBe(300);
    expect(r.total).toBe(900);
  });
});

describe('combinarCostoReal — casos que NO se callan (avisos)', () => {
  it('material NUNCA comprado: cae a precio de CATÁLOGO y avisa', () => {
    const r = combinarCostoReal(
      [requerido({ clave: 'tela-1', material: 'Felpa', requerido: 50, precioCatalogo: 30 })],
      [],
    );
    expect(r.tela).toBe(1500);
    expect(r.materiales[0]?.origenPrecio).toBe('catalogo');
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain('Felpa');
    expect(r.avisos[0]).toContain('catálogo');
  });

  it('material SIN ningún precio: cuenta 0 y avisa (nunca truena en silencio)', () => {
    const r = combinarCostoReal(
      [requerido({ clave: 'tela-1', material: 'Rib sin precio', requerido: 50 })],
      [],
    );
    expect(r.tela).toBe(0);
    expect(r.materiales[0]?.origenPrecio).toBe('sin-precio');
    expect(r.materiales[0]?.precioValuado).toBeNull();
    expect(r.avisos[0]).toContain('Rib sin precio');
  });

  it('compras LIBRES: se reportan aparte, NO entran al total, y avisan', () => {
    const r = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 10, ultimoPrecio: 10 })],
      [
        ligada({
          clave: 'libre:Flete',
          tipo: 'libre',
          idTela: null,
          material: 'Flete',
          cantidad: 1,
          precio: 850,
        }),
      ],
    );
    expect(r.importeLibre).toBe(850);
    expect(r.tela).toBe(100);
    expect(r.total).toBe(100); // el flete NO se cuela al costo de materiales
    expect(r.hayCompras).toBe(false); // una compra libre no habilita el default del real
    expect(r.avisos.some((a) => a.includes('LIBRE'))).toBe(true);
    expect(r.materiales.find((m) => m.tipo === 'libre')?.importe).toBe(0);
  });

  it('compra de un material FUERA del requerido: su compra SÍ entra al costo, con aviso', () => {
    const r = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 10, ultimoPrecio: 10 })],
      [
        ligada({
          clave: 'avio-77',
          tipo: 'avio',
          idTela: null,
          idAvio: 77,
          material: 'ETQ-9 — Etiqueta especial',
          cantidad: 500,
          precio: 0.4,
        }),
      ],
    );
    expect(r.avios).toBe(200);
    expect(r.tela).toBe(100);
    expect(r.total).toBe(300);
    expect(r.hayCompras).toBe(true);
    expect(r.avisos.some((a) => a.includes('Etiqueta especial'))).toBe(true);
  });

  it('orden sin requerido y sin compras: todo en cero, sin avisos y sin default de real', () => {
    const r = combinarCostoReal([], []);
    expect(r).toMatchObject({
      tela: 0,
      avios: 0,
      total: 0,
      importeDirecto: 0,
      importeValuado: 0,
      importeLibre: 0,
      hayCompras: false,
      avisos: [],
    });
    expect(r.materiales).toEqual([]);
  });

  it('un requerido en 0 sin compra no ensucia con avisos', () => {
    const r = combinarCostoReal([requerido({ clave: 'tela-1', requerido: 0 })], []);
    expect(r.avisos).toEqual([]);
    expect(r.materiales[0]?.origenPrecio).toBe('sin-precio');
  });
});

describe('combinarCostoReal — unidades y redondeo', () => {
  it('resta del requerido la cantidad ya CONVERTIDA a unidad de consumo (R1)', () => {
    // 2 cajas × 144 pzas = 288 pzas de consumo; el importe (2 × $720) NO cambia al convertir.
    const r = combinarCostoReal(
      [
        requerido({
          clave: 'avio-5',
          tipo: 'avio',
          idTela: null,
          idAvio: 5,
          unidad: 'pza',
          requerido: 300,
          ultimoPrecio: 5,
        }),
      ],
      [
        ligada({
          clave: 'avio-5',
          tipo: 'avio',
          idTela: null,
          idAvio: 5,
          cantidad: 2,
          cantidadConsumo: 288,
          unidad: 'caja',
          precio: 720,
        }),
      ],
    );
    expect(r.materiales[0]?.comprado).toBe(288);
    expect(r.materiales[0]?.cantidadValuada).toBe(12);
    expect(r.importeDirecto).toBe(1440);
    expect(r.importeValuado).toBe(60);
    expect(r.avios).toBe(1500);
  });

  it('redondea los importes a 2 decimales (sin artefactos de float)', () => {
    const r = combinarCostoReal(
      [requerido({ clave: 'tela-1', requerido: 3, ultimoPrecio: 0.1 })],
      [ligada({ clave: 'tela-1', cantidad: 0, precio: 0 })],
    );
    expect(r.tela).toBe(0.3);
  });
});
