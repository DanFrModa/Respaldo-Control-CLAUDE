/**
 * ⭐ Fila 0.231 — la regla pura de «¿esta OC de la explosión es del sobre-corte?». Cada condición de
 * la regla tiene su caso que la apaga por separado: si alguien le quita una, una de estas pruebas
 * se pone roja (es la forma de que la mutación inversa —quitar la condición— no sobreviva).
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';

import {
  avisoDeSobreCorteMixto,
  cubriaLoPedido,
  lineasParaMotivo,
  llaveOrdenMaterial,
  requeridoPedidoDelAvio,
  snapshotPorMaterial,
  TOLERANCIA_POR_RENGLON,
  propuestaDeMotivo,
  type LineaParaMotivo,
} from './motivo-propuesto.js';

/** Una línea del extra: avío, orden sobre-cortada, ya tenía OC. */
const delExtra = (over: Partial<LineaParaMotivo> = {}): LineaParaMotivo => ({
  tipo: 'avio',
  ordenConSobreCorte: true,
  cubriaLoPedido: true,
  ...over,
});

describe('propuestaDeMotivo', () => {
  it('todas las líneas son del extra ⇒ sobre-corte', () => {
    expect(propuestaDeMotivo([delExtra(), delExtra()])).toBe('sobre-corte');
  });

  it('sin líneas ⇒ nada (no hay compra que etiquetar)', () => {
    expect(propuestaDeMotivo([])).toBeNull();
  });

  it('lo comprado NO cubría lo pedido (primera compra tras cortar, o una compra corta) ⇒ nada', () => {
    expect(propuestaDeMotivo([delExtra({ cubriaLoPedido: false })])).toBeNull();
  });

  it('una orden SIN sobre-corte que ya tenía OC (faltante normal) ⇒ nada', () => {
    expect(propuestaDeMotivo([delExtra({ ordenConSobreCorte: false })])).toBeNull();
  });

  it('una TELA en la segunda pasada no es del extra (el sobre-corte no mueve la tela) ⇒ nada', () => {
    expect(propuestaDeMotivo([delExtra({ tipo: 'tela' })])).toBeNull();
  });

  it('el extra junto con algo que no lo es ⇒ mixto, por cada una de las tres condiciones', () => {
    expect(propuestaDeMotivo([delExtra(), delExtra({ cubriaLoPedido: false })])).toBe('mixto');
    expect(propuestaDeMotivo([delExtra(), delExtra({ ordenConSobreCorte: false })])).toBe('mixto');
    expect(propuestaDeMotivo([delExtra(), delExtra({ tipo: 'tela' })])).toBe('mixto');
    // El orden no importa.
    expect(propuestaDeMotivo([delExtra({ tipo: 'tela' }), delExtra()])).toBe('mixto');
  });
});

describe('avisoDeSobreCorteMixto', () => {
  it('nombra al proveedor y dice qué hacer', () => {
    const aviso = avisoDeSobreCorteMixto('Avíos del Centro');
    expect(aviso).toContain('Avíos del Centro');
    expect(aviso).toContain('nace como compra normal');
    expect(aviso).toContain('elígele el motivo');
  });
});

describe('lineasParaMotivo', () => {
  /** Botón (avío 9) de las OP 1 (sobre-cortada, ya compró) y 2 (sin sobre-corte, primera compra). */
  const oc = (seEscribe2: boolean) => ({
    renglones: [
      {
        tipo: 'avio' as const,
        idMaterial: 9,
        porOrden: [
          { idOrden: 1, seEscribe: true },
          { idOrden: 2, seEscribe: seEscribe2 },
        ],
      },
    ],
  });
  const cubria = (idOrden: number) => idOrden === 1;

  it('arma una línea por (renglón, OP) con lo que la regla necesita, preguntando por su material', () => {
    const preguntas: [number, string, number][] = [];
    const lineas = lineasParaMotivo(oc(true), new Set([1]), (idOrden, tipo, idMaterial) => {
      preguntas.push([idOrden, tipo, idMaterial]);
      return cubria(idOrden);
    });
    expect(lineas).toEqual([
      { tipo: 'avio', ordenConSobreCorte: true, cubriaLoPedido: true },
      { tipo: 'avio', ordenConSobreCorte: false, cubriaLoPedido: false },
    ]);
    expect(preguntas).toEqual([
      [1, 'avio', 9],
      [2, 'avio', 9],
    ]);
    expect(propuestaDeMotivo(lineas)).toBe('mixto');
  });

  it('🔴 una línea que NO se escribe no vota: la OC queda como sobre-corte, no como mixta', () => {
    const lineas = lineasParaMotivo(oc(false), new Set([1]), cubria);
    expect(lineas).toHaveLength(1);
    expect(propuestaDeMotivo(lineas)).toBe('sobre-corte');
  });
});

describe('cubriaLoPedido (H1/H5 del reviewer: el extra se mide POR CANTIDAD, contra lo pedido EXACTO)', () => {
  /** Botón: 6/prenda, 100 pedidas, 120 cortadas ⇒ requerido 720, pedido 600. Un renglón. */
  const boton = (yaComprado: number, over: Partial<Parameters<typeof cubriaLoPedido>[0]> = {}) =>
    cubriaLoPedido({
      requerido: 720,
      aComprar: 720,
      requeridoPedido: 600,
      yaComprado,
      renglones: 1,
      ...over,
    });

  it('compró lo pedido (600 de 600) ⇒ lo que falta es el extra', () => {
    expect(boton(600)).toBe(true);
    expect(boton(720)).toBe(true);
  });

  it('A: compró CORTO (500 de 600) ⇒ lo que falta incluye lo pedido: NO es extra', () => {
    expect(boton(500)).toBe(false);
  });

  it('B: receta corregida 6 → 8 tras cortar (720 ya comprados < 800 pedidos) ⇒ NO', () => {
    expect(boton(720, { requerido: 960, aComprar: 960, requeridoPedido: 800 })).toBe(false);
    expect(boton(800, { requerido: 960, aComprar: 960, requeridoPedido: 800 })).toBe(true);
  });

  it('la tolerancia es de un centavo por renglón más uno del reparto, ni más ni menos', () => {
    const tol = TOLERANCIA_POR_RENGLON * 2; // 1 renglón + el reparto
    expect(boton(600 - tol + 0.001)).toBe(true);
    expect(boton(600 - tol - 0.001)).toBe(false);
    // Con tres colores, tres centavos más uno.
    expect(boton(600 - 0.035, { renglones: 3 })).toBe(true);
    expect(boton(600 - 0.045, { renglones: 3 })).toBe(false);
  });

  it('genérico: lo que el stock ya cubría no se le exige a la compra', () => {
    // requerido 720, stock 300 (aComprar 420) ⇒ necesidad pedida = 600 − 300 = 300.
    expect(boton(300, { aComprar: 420 })).toBe(true);
    expect(boton(299, { aComprar: 420 })).toBe(false);
  });

  it('sin poder calcular lo pedido (no hay receta) no se afirma que cubría', () => {
    expect(boton(1_000_000, { requeridoPedido: null })).toBe(false);
  });
});

describe('requeridoPedidoDelAvio (H5: lo pedido EXACTO, con la regla R18 de la explosión)', () => {
  const D = (n: number) => new Prisma.Decimal(n);
  /** Botón por talla: CH 0.75, M 0.80 (consumo por prenda de respaldo 0.5). */
  const porTalla = {
    consumoPorPrenda: D(0.5),
    consumoPorTalla: true,
    tallas: [
      { idTalla: 1, consumo: D(0.75) },
      { idTalla: 2, consumo: D(0.8) },
    ],
  };

  it('suma consumo × piezas POR TALLA de lo pedido (no escala el requerido cortado)', () => {
    // Pedido CH 40 / M 60 ⇒ 30 + 48 = 78. (Una regla de tres desde lo cortado 40/80 daría 78.33.)
    expect(
      requeridoPedidoDelAvio(
        porTalla,
        new Map([
          [1, 40],
          [2, 60],
        ]),
      ),
    ).toBeCloseTo(78, 10);
  });

  it('una talla sin consumo capturado cae al consumo por prenda (la misma regla R18)', () => {
    expect(
      requeridoPedidoDelAvio(
        porTalla,
        new Map([
          [1, 40],
          [3, 10],
        ]),
      ),
    ).toBeCloseTo(35, 10);
  });

  it('sin consumo por talla: consumo × total', () => {
    expect(
      requeridoPedidoDelAvio(
        { consumoPorPrenda: D(6), consumoPorTalla: false, tallas: [] },
        new Map([
          [1, 40],
          [2, 60],
        ]),
      ),
    ).toBe(600);
  });
});

describe('snapshotPorMaterial', () => {
  it('suma requerido y a comprar de los renglones de color de un material en una orden, y los CUENTA', () => {
    const resumen = snapshotPorMaterial([
      // Botón (avío 9) de la orden 1 en dos colores.
      { idOrden: 1, idTela: null, idAvio: 9, cantidadRequerida: 300, cantidadAComprar: 300 },
      { idOrden: 1, idTela: null, idAvio: 9, cantidadRequerida: 420, cantidadAComprar: 400 },
      { idOrden: 1, idTela: 5, idAvio: null, cantidadRequerida: 150, cantidadAComprar: 150 },
      // El mismo botón en OTRA orden no se mezcla.
      { idOrden: 2, idTela: null, idAvio: 9, cantidadRequerida: 60, cantidadAComprar: 60 },
    ]);
    expect(resumen.get(llaveOrdenMaterial(1, 'avio-9'))).toEqual({
      requerido: 720,
      aComprar: 700,
      renglones: 2,
    });
    expect(resumen.get(llaveOrdenMaterial(1, 'tela-5'))).toEqual({
      requerido: 150,
      aComprar: 150,
      renglones: 1,
    });
    expect(resumen.get(llaveOrdenMaterial(2, 'avio-9'))).toEqual({
      requerido: 60,
      aComprar: 60,
      renglones: 1,
    });
  });
});
