import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';

import {
  requeridoAvioReceta,
  requeridoContradictorioPorMedida,
  type AvioRecetaR18,
} from './receta-avios.js';

const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);

/** Avío base (6/prenda, sin talla), sobrescribible. */
function avio(over: Partial<AvioRecetaR18> = {}): AvioRecetaR18 {
  return { consumoPorPrenda: D(6), consumoPorTalla: false, tallas: [], ...over };
}

// Orden de 30 pzas: CH 10 + M 20.
const piezasPorTalla = new Map<number, number>([
  [1, 10],
  [2, 20],
]);

describe('requeridoAvioReceta (R18 — helper compartido MRP ↔ Habilitación)', () => {
  it('sin consumo por talla: consumoPorPrenda × totalPiezas', () => {
    const r = requeridoAvioReceta(avio(), 30, piezasPorTalla);
    expect(r.requerido).toBe(180);
    expect(r.tallasSinMedida).toEqual([]);
  });

  it('con consumo por talla: Σ(medida × piezas de esa talla)', () => {
    const r = requeridoAvioReceta(
      avio({
        consumoPorTalla: true,
        tallas: [
          { idTalla: 1, consumo: D(3) },
          { idTalla: 2, consumo: D(4) },
        ],
      }),
      30,
      piezasPorTalla,
    );
    expect(r.requerido).toBe(110); // 3×10 + 4×20
    expect(r.tallasSinMedida).toEqual([]);
  });

  it('talla presente en la orden SIN medida: cae a consumoPorPrenda y la reporta', () => {
    const r = requeridoAvioReceta(
      avio({ consumoPorTalla: true, tallas: [{ idTalla: 1, consumo: D(3) }] }),
      30,
      piezasPorTalla,
    );
    expect(r.requerido).toBe(150); // 3×10 (CH con medida) + 6×20 (M sin medida → consumoPorPrenda)
    expect(r.tallasSinMedida).toEqual([2]);
  });

  it('⭐ "sin medida" y "medida CERO" NO son lo mismo (V1-E3c)', () => {
    // Sin fila para la talla 2 (así queda una talla dejada en blanco en el editor): cae al
    // consumo por prenda Y se reporta, que es justo el aviso que el MRP le enseña al usuario.
    const sinFila = requeridoAvioReceta(
      avio({ consumoPorTalla: true, tallas: [{ idTalla: 1, consumo: D(3) }] }),
      30,
      piezasPorTalla,
    );
    expect(sinFila.requerido).toBe(150);
    expect(sinFila.tallasSinMedida).toEqual([2]);

    // Con una fila de CERO capturada a propósito: requiere cero para esa talla y NO avisa. Si el
    // editor guardara las tallas en blanco como 0, TODAS caerían aquí y el aviso desaparecería.
    const conCero = requeridoAvioReceta(
      avio({
        consumoPorTalla: true,
        tallas: [
          { idTalla: 1, consumo: D(3) },
          { idTalla: 2, consumo: D(0) },
        ],
      }),
      30,
      piezasPorTalla,
    );
    expect(conCero.requerido).toBe(30); // 3×10 + 0×20
    expect(conCero.tallasSinMedida).toEqual([]);
  });

  it('⭐ V1-E3g: una talla con CERO PIEZAS no cuenta ni avisa (§Post-F9.64, D4)', () => {
    // La matriz color×talla puede traer una talla en 0 (se abrió la columna y no se llenó). Esa
    // talla no se va a producir: ni suma al requerido ni "le falta" medida. Antes se colaba en
    // `tallasSinMedida` y el aviso señalaba tallas que nadie iba a cortar.
    const conTallaEnCero = new Map<number, number>([
      [1, 10],
      [2, 20],
      [3, 0],
    ]);
    const r = requeridoAvioReceta(
      avio({
        consumoPorTalla: true,
        tallas: [
          { idTalla: 1, consumo: D(3) },
          { idTalla: 2, consumo: D(4) },
        ],
      }),
      30,
      conTallaEnCero,
    );
    expect(r.requerido).toBe(110); // igual que sin la talla en cero
    expect(r.tallasSinMedida).toEqual([]); // la talla 3 NO aparece
  });
});

/**
 * ⭐⭐ §Post-F9.105 — LA CONTRADICCIÓN «avío POR MEDIDA con cantidades POR TALLA», MEDIDA.
 *
 * El caso real: un cierre de 53 cm cuya longitud quedó capturada en el campo de CANTIDAD. La orden
 * pide 1 pza por prenda, pero el requerido sale como si pidiera 53.
 */
describe('requeridoContradictorioPorMedida (§Post-F9.105 — cuánto se pide de más)', () => {
  it('sin la bandera encendida NO hay contradicción que medir (null)', () => {
    expect(requeridoContradictorioPorMedida(avio(), 30, piezasPorTalla)).toBeNull();
  });

  it('⭐ el cierre de 53: dice el requerido de hoy Y el que saldría normalizado', () => {
    const medido = requeridoContradictorioPorMedida(
      avio({
        consumoPorPrenda: D(1), // 1 pza por prenda: lo que de verdad lleva
        consumoPorTalla: true,
        tallas: [
          { idTalla: 1, consumo: D(53) }, // la LONGITUD, capturada como cantidad
          { idTalla: 2, consumo: D(55) },
        ],
      }),
      30,
      piezasPorTalla,
      'pza',
    );
    // 53×10 + 55×20 = 1,630 pza… contra las 30 pza que de verdad se necesitan.
    expect(medido).toEqual({ hoy: 1630, normalizado: 30, unidad: 'pza' });
  });

  it('la cuenta del normalizado es la MISMA regla R18 con la bandera apagada', () => {
    const conBandera = avio({ consumoPorPrenda: D(2), consumoPorTalla: true, tallas: [] });
    const medido = requeridoContradictorioPorMedida(conBandera, 30, piezasPorTalla);
    // Sin ninguna medida capturada, R18 cae al consumo por prenda: hoy y normalizado coinciden y
    // no hay exceso que reportar (el aviso lo dirá sin magnitud).
    expect(medido).toEqual({ hoy: 60, normalizado: 60, unidad: null });
  });

  it('NO corrige nada: `requeridoAvioReceta` sigue devolviendo el requerido INFLADO (D3)', () => {
    const inflado = avio({
      consumoPorPrenda: D(1),
      consumoPorTalla: true,
      tallas: [
        { idTalla: 1, consumo: D(53) },
        { idTalla: 2, consumo: D(53) },
      ],
    });
    requeridoContradictorioPorMedida(inflado, 30, piezasPorTalla, 'pza');
    // Medir la contradicción NO apaga la bandera ni cambia el cálculo: eso pasa al GUARDAR.
    expect(requeridoAvioReceta(inflado, 30, piezasPorTalla).requerido).toBe(1590);
  });
});
