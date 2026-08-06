/**
 * Tests UNITARIOS de la RESOLUCIÓN DE PRECIOS amarrados (F8-E1; R17/D13). Funciones PURAS: cubren
 * las 4 cascadas de TELA (amarre-color → amarre → color-referencia → sugerido) y las 3 de AVÍO
 * (amarre → más barato → referencia), incluidos los bordes (sin nada, amarre sin precio, factor de
 * conversión). El cuadre contra el pre-costo real de F7 vive en `pre-costo.test.ts` (no-regresión).
 */
import { describe, expect, it } from 'vitest';

import {
  resolverPrecioAvio,
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
    expect(r).toEqual({ precio: 85, origen: 'amarre-color' });
  });

  it('2) amarre (base): si el proveedor amarrado NO maneja color, usa TelaProveedor.precio', () => {
    const r = resolverPrecioTela({
      precioSugerido: 100,
      precioColorReferencia: 90,
      amarre: { precio: 80, manejaPrecioPorColor: false, precioColor: 85 },
    });
    expect(r).toEqual({ precio: 80, origen: 'amarre' });
  });

  it('2b) amarre maneja color PERO ese color no tiene precio → cae al precio base del amarre', () => {
    const r = resolverPrecioTela({
      precioSugerido: 100,
      precioColorReferencia: 90,
      amarre: { precio: 80, manejaPrecioPorColor: true, precioColor: null },
    });
    expect(r).toEqual({ precio: 80, origen: 'amarre' });
  });

  it('3) referencia por color: sin amarre, usa TelaColor.precio del color en contexto', () => {
    const r = resolverPrecioTela({ precioSugerido: 100, precioColorReferencia: 90, amarre: null });
    expect(r).toEqual({ precio: 90, origen: 'color-referencia' });
  });

  it('3b) amarre presente pero SIN precio base ni color → cae a la referencia por color', () => {
    const r = resolverPrecioTela({
      precioSugerido: 100,
      precioColorReferencia: 90,
      amarre: { precio: null, manejaPrecioPorColor: true, precioColor: null },
    });
    expect(r).toEqual({ precio: 90, origen: 'color-referencia' });
  });

  it('4) sugerido: sin amarre ni referencia por color, usa Tela.precioSugerido (el de F7)', () => {
    const r = resolverPrecioTela({ precioSugerido: 100 });
    expect(r).toEqual({ precio: 100, origen: 'sugerido' });
  });

  it('sin NADA en ningún escalón → precio null, origen sin-precio (no truena)', () => {
    const r = resolverPrecioTela({ precioSugerido: null });
    expect(r).toEqual({ precio: null, origen: 'sin-precio' });
  });

  it('un precio de 0 es válido (una tela regalada), no se salta como si fuera nulo', () => {
    const r = resolverPrecioTela({
      precioSugerido: 100,
      amarre: { precio: 0, manejaPrecioPorColor: false },
    });
    expect(r).toEqual({ precio: 0, origen: 'amarre' });
  });
});

describe('resolverPrecioAvio (cascada de 3 pasos + normalización por factor, R1/R17)', () => {
  it('1) amarre: usa el proveedor amarrado, normalizando por SU factor (precio ÷ factor)', () => {
    const r = resolverPrecioAvio({
      precioReferencia: 10,
      factorConversionAvio: null,
      idAvioProveedor: 2,
      proveedores: [
        { idProveedor: 1, precio: 100, factorConversion: 50 }, // 2/u (más barato) pero NO amarrado
        { idProveedor: 2, precio: 500, factorConversion: 50 }, // 10/u, amarrado → gana
      ],
    });
    expect(r).toEqual({ precio: 10, origen: 'amarre', idProveedor: 2 });
  });

  it('2) más barato: sin amarre, elige el menor costo YA normalizado', () => {
    const r = resolverPrecioAvio({
      precioReferencia: 10,
      factorConversionAvio: null,
      proveedores: [
        { idProveedor: 1, precio: 500, factorConversion: 50 }, // 10/u
        { idProveedor: 2, precio: 300, factorConversion: 50 }, // 6/u → más barato
      ],
    });
    expect(r).toEqual({ precio: 6, origen: 'mas-barato', idProveedor: 2 });
  });

  it('usa el factor del AVÍO cuando el proveedor no define el suyo (fallback R1)', () => {
    const r = resolverPrecioAvio({
      precioReferencia: null,
      factorConversionAvio: 10, // fallback
      proveedores: [{ idProveedor: 7, precio: 100, factorConversion: null }], // 100/10 = 10
    });
    expect(r).toEqual({ precio: 10, origen: 'mas-barato', idProveedor: 7 });
  });

  it('amarre presente pero el proveedor amarrado no tiene precio → cae a "más barato"', () => {
    const r = resolverPrecioAvio({
      precioReferencia: 10,
      factorConversionAvio: null,
      idAvioProveedor: 1,
      proveedores: [
        { idProveedor: 1, precio: null, factorConversion: null }, // amarrado, sin precio
        { idProveedor: 2, precio: 4, factorConversion: null }, // gana por defecto
      ],
    });
    expect(r).toEqual({ precio: 4, origen: 'mas-barato', idProveedor: 2 });
  });

  it('3) referencia: sin proveedores con precio, usa Avio.precioReferencia', () => {
    const r = resolverPrecioAvio({
      precioReferencia: 12,
      factorConversionAvio: null,
      proveedores: [{ idProveedor: 1, precio: null, factorConversion: null }],
    });
    expect(r).toEqual({ precio: 12, origen: 'referencia', idProveedor: null });
  });

  it('sin proveedores ni referencia → precio null, origen sin-precio', () => {
    const r = resolverPrecioAvio({
      precioReferencia: null,
      factorConversionAvio: null,
      proveedores: [],
    });
    expect(r).toEqual({ precio: null, origen: 'sin-precio', idProveedor: null });
  });

  it('sin factores (1:1) el precio de compra ES el costo por unidad', () => {
    const r = resolverPrecioAvio({
      precioReferencia: null,
      factorConversionAvio: null,
      proveedores: [{ idProveedor: 3, precio: 7.5, factorConversion: null }],
    });
    expect(r.precio).toBeCloseTo(7.5, 6);
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
    ).toEqual({ precio: 42, origen: 'sugerido' });
  });
});
