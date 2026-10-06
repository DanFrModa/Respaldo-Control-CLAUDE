import { describe, expect, it } from 'vitest';

import {
  claveExistencia,
  existenciaDeCelda,
  existenciaDeSeguimiento,
  leyendaExistencia,
  piezasExcedidas,
} from './existencia-entrega';

/**
 * ⭐ Fila 0.219 — las reglas PURAS de la existencia en la entrega a cliente. Las pantallas las
 * prueban de punta a punta (`EntregaClientePagina.test.tsx`, `AvanceCaptura.test.tsx`); aquí se fijan
 * los bordes que allá costaría montar.
 */
const SEGUIMIENTO = {
  celdas: [
    { idColor: 7, idTalla: 11, disponible: 5 },
    { idColor: 7, idTalla: 12, disponible: 0 },
    { idColor: 8, idTalla: 11, disponible: 8 },
  ],
};

describe('existenciaDeSeguimiento — ¿se sabe qué hay?', () => {
  it('con almacén, respuesta propia y sin error: el mapa por color:talla', () => {
    const mapa = existenciaDeSeguimiento({ data: SEGUIMIENTO }, true);
    expect(mapa?.get(claveExistencia(7, 11))).toBe(5);
    expect(mapa?.get(claveExistencia(7, 12))).toBe(0);
    expect(mapa?.get(claveExistencia(8, 11))).toBe(8);
  });

  it.each([
    ['sin almacén elegido', { data: SEGUIMIENTO }, false],
    ['cargando (sin respuesta)', { data: undefined }, true],
    ['dato del almacén ANTERIOR', { data: SEGUIMIENTO, isPlaceholderData: true }, true],
    ['la consulta falló', { data: SEGUIMIENTO, isError: true }, true],
  ] as const)('%s ⇒ `undefined` (no se sabe)', (_caso, consulta, almacen) => {
    expect(existenciaDeSeguimiento(consulta, almacen)).toBeUndefined();
  });
});

describe('existenciaDeCelda', () => {
  it('la celda que no viene vale CERO (con la existencia conocida)', () => {
    const mapa = existenciaDeSeguimiento({ data: SEGUIMIENTO }, true) ?? new Map<string, number>();
    expect(existenciaDeCelda(mapa, 8, 12)).toBe(0);
    expect(existenciaDeCelda(mapa, 8, 11)).toBe(8);
  });
});

describe('leyendaExistencia', () => {
  it('cabe ⇒ «Hay N» (normal), también al tope exacto', () => {
    expect(leyendaExistencia(0, 5)).toEqual({ tono: 'normal', texto: 'Hay 5' });
    expect(leyendaExistencia(5, 5)).toEqual({ tono: 'normal', texto: 'Hay 5' });
  });
  it('rebasa ⇒ «Excede · hay N» (crit)', () => {
    expect(leyendaExistencia(6, 5)).toEqual({ tono: 'crit', texto: 'Excede · hay 5' });
  });
  it('cero (o negativo) ⇒ «Sin existencia» (crit), haya o no captura', () => {
    expect(leyendaExistencia(0, 0)).toEqual({ tono: 'crit', texto: 'Sin existencia' });
    expect(leyendaExistencia(3, -2)).toEqual({ tono: 'crit', texto: 'Sin existencia' });
  });
  it('miles con formato es-MX', () => {
    expect(leyendaExistencia(0, 1500).texto).toBe('Hay 1,500');
  });
});

describe('piezasExcedidas', () => {
  const mapa = existenciaDeSeguimiento({ data: SEGUIMIENTO }, true);

  it('suma lo que rebasa CADA celda contra SU existencia (no contra otra talla ni otro color)', () => {
    // Rojo CH 7 (hay 5 → 2 de más) · Rojo M 1 (hay 0 → 1) · Azul CH 6 (hay 8 → 0).
    expect(
      piezasExcedidas(
        [
          { idColor: 7, idTalla: 11, cantidad: 7 },
          { idColor: 7, idTalla: 12, cantidad: 1 },
          { idColor: 8, idTalla: 11, cantidad: 6 },
        ],
        mapa,
      ),
    ).toBe(3);
  });

  it('con la existencia DESCONOCIDA es 0: no se inventa un cero', () => {
    expect(piezasExcedidas([{ idColor: 7, idTalla: 12, cantidad: 99 }], undefined)).toBe(0);
  });
});
