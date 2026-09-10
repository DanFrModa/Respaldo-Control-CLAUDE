/**
 * Unit de `piezasRecibibles` (`matriz-orden.ts`) — el número que el SELECTOR de maquilero anuncia
 * («N pza(s) por recibirle») y que decide **a quién se le ofrece recibir**.
 *
 * Nació de una mutación de V1-E8v: al cambiar la función de `recibible` a `cantidad` (los dos campos
 * colapsaron, §Post-F9.147) se probó a quitarle el `Math.max(0, …)` y **la suite entera se quedó
 * verde**. Ese piso a 0 nunca había tenido una aserción propia, aunque la ficha de V1-E8k lo daba por
 * cubierto: era una guarda viva que nada mataba.
 */
import { describe, expect, it } from 'vitest';

import type { Orden } from '@/api/tipos';

import {
  coloresDeOrden,
  ejesDeOrden,
  ejesDeOrdenPlegados,
  lineasVaciasDeOrden,
  piezasRecibibles,
} from './matriz-orden';

/** Una celda mínima con lo único que la función mira. */
const celda = (cantidad: number): { cantidad: number } => ({ cantidad });

describe('piezasRecibibles', () => {
  it('suma el pendiente de las celdas', () => {
    expect(piezasRecibibles([celda(4), celda(6)])).toBe(10);
  });

  it('🔴 SÓLO las celdas positivas: +5 y −5 del histórico migrado dan 5, no 0', () => {
    // En el Access un recibo podía capturarse en la talla equivocada: sobra en una y falta en otra.
    // Sumando con signo el total da 0 y el selector diría «0 pza(s) por recibirle» — falso: al
    // maquilero SÍ se le pueden recibir esas 5 (hallazgo del reviewer en V1-E8k). El servidor
    // acepta la celda positiva y rechaza la negativa, celda por celda.
    expect(piezasRecibibles([celda(5), celda(-5)])).toBe(5);
  });

  it('un maquilero que sólo tiene celdas negativas no tiene NADA que devolver', () => {
    // Recibos sin envío (histórico migrado): pendiente negativo, pero no hay qué recibirle.
    expect(piezasRecibibles([celda(-3), celda(-2)])).toBe(0);
  });

  it('sin celdas es 0 (no NaN ni undefined)', () => {
    expect(piezasRecibibles([])).toBe(0);
  });
});

// ── ⭐ LOS EJES DE LA CAPTURA CON EL PACK (§Post-F9.10) ────────────────────────────────────────
//
// Una orden con DOS tendidos del mismo color es la que separa a las dos funciones: la captura de
// producción necesita las dos filas (el corte y el envío se llevan tendido por tendido) y las
// etapas que NO manejan pack —la entrega a cliente, la auditoría— necesitan UNA (sus celdas del
// servidor vienen sin pack, y dos filas del mismo color se pisarían la llave).

/** Orden de un color con dos tendidos (A y B) y una talla cada uno. */
const ordenConTendidos = {
  lineas: [
    {
      idColor: 7,
      color: 'Rojo',
      pack: 'A',
      tallas: [{ idTalla: 11, etiquetaTalla: 'CH', cantidad: 6 }],
    },
    {
      idColor: 7,
      color: 'Rojo',
      pack: 'B',
      tallas: [
        { idTalla: 11, etiquetaTalla: 'CH', cantidad: 4 },
        { idTalla: 12, etiquetaTalla: 'M', cantidad: 2 },
      ],
    },
  ],
} as unknown as Orden;

describe('ejesDeOrden / ejesDeOrdenPlegados', () => {
  it('`ejesDeOrden` da UNA FILA POR TENDIDO, con su pack', () => {
    expect(ejesDeOrden(ordenConTendidos).colores).toEqual([
      { idColor: 7, nombre: 'Rojo', pack: 'A' },
      { idColor: 7, nombre: 'Rojo', pack: 'B' },
    ]);
  });

  it('`ejesDeOrdenPlegados` da UNA sola fila por color, con el pack VACÍO', () => {
    // El pack vacío no es cosmético: las celdas de la entrega a cliente vienen así del servidor, y
    // la llave de celda las busca por `color:talla:pack`.
    expect(ejesDeOrdenPlegados(ordenConTendidos).colores).toEqual([
      { idColor: 7, nombre: 'Rojo', pack: '' },
    ]);
  });

  it('las columnas son las MISMAS en las dos (la unión de las tallas de todos los tendidos)', () => {
    const tallas = [
      { idTalla: 11, etiqueta: 'CH' },
      { idTalla: 12, etiqueta: 'M' },
    ];
    expect(ejesDeOrden(ordenConTendidos).tallas).toEqual(tallas);
    expect(ejesDeOrdenPlegados(ordenConTendidos).tallas).toEqual(tallas);
  });
});

describe('coloresDeOrden / lineasVaciasDeOrden (los flujos SIN pack)', () => {
  it('no repiten el color cuando la orden trae dos tendidos', () => {
    // El componente que consumen llavea sus filas por `idColor`: dos opciones o dos filas iguales
    // se pisarían la una a la otra (misma `key` de React, misma celda).
    expect(coloresDeOrden(ordenConTendidos)).toEqual([{ id: 7, nombre: 'Rojo' }]);
    expect(lineasVaciasDeOrden(ordenConTendidos)).toEqual([
      { idColor: 7, color: 'Rojo', cantidades: {} },
    ]);
  });
});
