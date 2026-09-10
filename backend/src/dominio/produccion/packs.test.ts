/**
 * Tests UNITARIOS del PACK / TENDIDO (§Post-F9.10) — la aritmética pura de `packs.ts`, sin Postgres.
 *
 * ⭐ EL CENTRO DE ESTE ARCHIVO es {@link excesosDelRecibo}: lo que Daniel pidió *«definir (y
 * probar)»* cuando decidió que el pack sea **opcional al recibir**:
 *
 *   *«Un recibo SIN pack consume del saldo AGREGADO de todos los packs de esa orden y proceso; uno
 *   CON pack, del suyo. Hay que definir (y probar) que las dos formas convivan sin permitir recibir
 *   de más en total.»*
 *
 * Por eso las pruebas van en TERNA y no de a una: «con pack topa por pack», su gemela «sin pack topa
 * al agregado», y la tercera —la que de verdad importa— «las dos juntas no dejan recibir de más EN
 * TOTAL». Cualquiera de las dos primeras pasa sola con una implementación que sólo mire una de las
 * condiciones; la tercera no.
 *
 * Y la propiedad que más se cuida: 🔴 **una orden SIN packs se comporta exactamente igual que antes
 * de esta etapa**. Se prueba explícitamente, no por analogía.
 *
 * La integración con la BD (lock, cancelaciones, por maquilero, calidad, incompletas) vive en
 * `recibos.int.test.ts`; las reglas de captura de la matriz, en `etapas.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  SIN_PACK,
  claveCeldaPack,
  coloresReempacados,
  esSinPack,
  excesosDelRecibo,
  normalizarPack,
  ordenManejaPacks,
  packsPorColor,
  type CeldaRecibidaParaTope,
  type SaldosDelRecibo,
} from './packs.js';

// ── Utilidades de armado (explícitas: cada prueba dice sus cuatro saldos) ────────────────────────

const COLOR = 7;
const TALLA = 3;

/**
 * Arma los saldos a partir de listas legibles `[pack, piezas]`. El tercero —lo SALDADO al cerrar la
 * orden con el maquilero (V1, fila 0.109)— es opcional y por default va vacío: casi todas estas
 * pruebas son del PACK, no del cierre.
 */
function saldos(
  enviado: [pack: string, piezas: number][],
  devuelto: [pack: string, piezas: number][],
  saldado: [pack: string, piezas: number][] = [],
): SaldosDelRecibo {
  const porPack = (filas: [string, number][]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const [pack, piezas] of filas) {
      const clave = claveCeldaPack(COLOR, TALLA, pack);
      m.set(clave, (m.get(clave) ?? 0) + piezas);
    }
    return m;
  };
  const total = (filas: [string, number][]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const [, piezas] of filas) {
      m.set(`${COLOR}:${TALLA}`, (m.get(`${COLOR}:${TALLA}`) ?? 0) + piezas);
    }
    return m;
  };
  return {
    enviadoPorPack: porPack(enviado),
    devueltoPorPack: porPack(devuelto),
    enviadoTotal: total(enviado),
    devueltoTotal: total(devuelto),
    // Lo SALDADO consume saldo igual que lo devuelto (V1, fila 0.109): una vez cerrada la orden,
    // esas piezas ya no se pueden recibir.
    saldadoPorPack: porPack(saldado),
    saldadoTotal: total(saldado),
  };
}

/** Una celda de captura. `devuelveAhora` = buenas + incompletas (lo que físicamente vuelve). */
function celda(pack: string, devuelveAhora: number): CeldaRecibidaParaTope {
  return { idColor: COLOR, idTalla: TALLA, pack, devuelveAhora };
}

describe('normalizarPack / esSinPack / ordenManejaPacks', () => {
  it('colapsa ausente, nulo y espacios al mismo «sin pack»', () => {
    expect(normalizarPack(undefined)).toBe(SIN_PACK);
    expect(normalizarPack(null)).toBe(SIN_PACK);
    expect(normalizarPack('   ')).toBe(SIN_PACK);
    expect(esSinPack('  ')).toBe(true);
    expect(esSinPack('A')).toBe(false);
  });

  it('recorta el pack pero conserva su texto', () => {
    expect(normalizarPack('  A ')).toBe('A');
    expect(normalizarPack('PACK 1')).toBe('PACK 1');
  });

  it('una orden maneja packs en cuanto UN renglón trae pack', () => {
    expect(ordenManejaPacks([])).toBe(false);
    expect(ordenManejaPacks(['', '', ''])).toBe(false);
    expect(ordenManejaPacks(['', '  '])).toBe(false);
    expect(ordenManejaPacks(['', 'B'])).toBe(true);
    expect(ordenManejaPacks(['A', 'B'])).toBe(true);
  });
});

describe('claveCeldaPack', () => {
  it('distingue dos tendidos del mismo color y talla', () => {
    expect(claveCeldaPack(1, 2, 'A')).not.toBe(claveCeldaPack(1, 2, 'B'));
  });

  it('normaliza el pack dentro de la llave (los espacios no crean un tendido nuevo)', () => {
    expect(claveCeldaPack(1, 2, ' A ')).toBe(claveCeldaPack(1, 2, 'A'));
  });

  it('no confunde una etiqueta con «:» con otra celda: el pack es TODO lo que sigue', () => {
    // Los dos primeros segmentos son enteros, así que el resto es inequívocamente el pack.
    expect(claveCeldaPack(1, 2, 'A:B')).toBe('1:2:A:B');
    expect(claveCeldaPack(1, 2, 'A:B')).not.toBe(claveCeldaPack(1, 2, 'A'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭐⭐ EL TOPE HÍBRIDO — la terna que Daniel pidió definir y probar
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('excesosDelRecibo — orden SIN packs (tiene que comportarse EXACTAMENTE como antes)', () => {
  it('deja recibir hasta lo enviado', () => {
    // 100 enviadas, 40 ya devueltas ⇒ caben 60.
    const s = saldos([[SIN_PACK, 100]], [[SIN_PACK, 40]]);
    expect(excesosDelRecibo([celda(SIN_PACK, 60)], s)).toEqual([]);
  });

  it('rechaza UNA pieza de más, y dice cuánto pide y cuánto queda', () => {
    const s = saldos([[SIN_PACK, 100]], [[SIN_PACK, 40]]);
    expect(excesosDelRecibo([celda(SIN_PACK, 61)], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 61, disponible: 60 },
    ]);
  });

  it('NUNCA levanta la condición por pack: el renglón sin pack no la dispara', () => {
    // Aunque el saldo por pack del bucket vacío fuera 0, la única condición que aplica es la total.
    const s: SaldosDelRecibo = {
      enviadoPorPack: new Map(),
      devueltoPorPack: new Map(),
      enviadoTotal: new Map([[`${COLOR}:${TALLA}`, 100]]),
      devueltoTotal: new Map(),
      saldadoPorPack: new Map(),
      saldadoTotal: new Map(),
    };
    expect(excesosDelRecibo([celda(SIN_PACK, 100)], s)).toEqual([]);
  });

  it('sin envío, no cabe ni una pieza', () => {
    expect(excesosDelRecibo([celda(SIN_PACK, 1)], saldos([], []))).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 1, disponible: 0 },
    ]);
  });
});

describe('excesosDelRecibo — (2) CON pack: el saldo se lleva por pack', () => {
  it('deja recibir lo enviado de SU pack', () => {
    const s = saldos(
      [
        ['A', 40],
        ['B', 60],
      ],
      [],
    );
    expect(excesosDelRecibo([celda('A', 40)], s)).toEqual([]);
  });

  it('🔴 rechaza recibir del pack A lo que se envió del pack B, aunque el TOTAL cuadre', () => {
    // 40 de A + 60 de B = 100 en total. Recibir 100 de A cuadra en el agregado y NO en el pack.
    const s = saldos(
      [
        ['A', 40],
        ['B', 60],
      ],
      [],
    );
    expect(excesosDelRecibo([celda('A', 100)], s)).toEqual([
      { motivo: 'pack', idColor: COLOR, idTalla: TALLA, pack: 'A', pide: 100, disponible: 40 },
    ]);
  });

  it('descuenta lo ya devuelto DE ESE PACK, no lo devuelto del otro', () => {
    const s = saldos(
      [
        ['A', 40],
        ['B', 60],
      ],
      [['B', 60]],
    );
    // A sigue entero: 40 caben.
    expect(excesosDelRecibo([celda('A', 40)], s)).toEqual([]);
    // Y B ya está cerrado: ni una más.
    expect(excesosDelRecibo([celda('B', 1)], s)).toEqual([
      { motivo: 'pack', idColor: COLOR, idTalla: TALLA, pack: 'B', pide: 1, disponible: 0 },
    ]);
  });

  it('los espacios de la etiqueta no abren un saldo nuevo', () => {
    const s = saldos([['A', 10]], [['A', 10]]);
    // Con UN solo pack, agotarlo agota también el agregado: las DOS condiciones se quejan, y las
    // dos dicen la verdad. Se afirman las dos a propósito — quedarse con una sola dejaría pasar una
    // implementación que hubiera dejado de evaluar la otra.
    expect(excesosDelRecibo([celda(' A ', 1)], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 1, disponible: 0 },
      { motivo: 'pack', idColor: COLOR, idTalla: TALLA, pack: 'A', pide: 1, disponible: 0 },
    ]);
  });
});

describe('excesosDelRecibo — (1) SIN pack: consume del saldo AGREGADO de todos los packs', () => {
  it('deja recibir sin pack más de lo que cabe en un solo pack (los devolvió revueltos)', () => {
    // 40 de A + 60 de B: un recibo SIN pack de 100 es exactamente lo enviado.
    const s = saldos(
      [
        ['A', 40],
        ['B', 60],
      ],
      [],
    );
    expect(excesosDelRecibo([celda(SIN_PACK, 100)], s)).toEqual([]);
  });

  it('pero no más que el agregado', () => {
    const s = saldos(
      [
        ['A', 40],
        ['B', 60],
      ],
      [],
    );
    expect(excesosDelRecibo([celda(SIN_PACK, 101)], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 101, disponible: 100 },
    ]);
  });

  it('lo ya devuelto CON pack le baja el agregado a un recibo SIN pack', () => {
    const s = saldos(
      [
        ['A', 40],
        ['B', 60],
      ],
      [['A', 40]],
    );
    expect(excesosDelRecibo([celda(SIN_PACK, 60)], s)).toEqual([]);
    expect(excesosDelRecibo([celda(SIN_PACK, 61)], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 61, disponible: 60 },
    ]);
  });
});

describe('⭐ excesosDelRecibo — (3) LAS DOS FORMAS JUNTAS no dejan recibir de más EN TOTAL', () => {
  it('🔴 un recibo SIN pack no puede colarse por encima de lo ya devuelto CON pack', () => {
    // Enviado: A=5, B=5 (total 10). Ya devuelto: 5 de A y 5 de B ⇒ no queda NADA.
    // Sin la condición TOTAL, un renglón sin pack no dispara ninguna guarda y pasarían 5 más.
    const s = saldos(
      [
        ['A', 5],
        ['B', 5],
      ],
      [
        ['A', 5],
        ['B', 5],
      ],
    );
    expect(excesosDelRecibo([celda(SIN_PACK, 5)], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 5, disponible: 0 },
    ]);
  });

  it('🔴 lo ya devuelto SIN pack le baja el saldo al recibo CON pack, vía el total', () => {
    // Enviado A=5, B=5. Ya devuelto: 10 SIN pack ⇒ el agregado está en 0, aunque el saldo POR PACK
    // de A siga diciendo 5 (nadie le imputó nada). El tope total es el que cobra.
    const s = saldos(
      [
        ['A', 5],
        ['B', 5],
      ],
      [[SIN_PACK, 10]],
    );
    expect(excesosDelRecibo([celda('A', 1)], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 1, disponible: 0 },
    ]);
  });

  it('🔴 en UNA MISMA captura, los renglones de la misma celda se topan JUNTOS', () => {
    // Enviado A=5, B=5 (total 10). Una captura con 5 de A + 5 de B + 5 sin pack son 15: cada
    // renglón cabe por su lado y el conjunto NO. Topar renglón por renglón habría dejado pasar 15.
    const s = saldos(
      [
        ['A', 5],
        ['B', 5],
      ],
      [],
    );
    const excesos = excesosDelRecibo([celda('A', 5), celda('B', 5), celda(SIN_PACK, 5)], s);
    expect(excesos).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 15, disponible: 10 },
    ]);
  });

  it('y la misma captura SIN el renglón de sobra sí cabe entera', () => {
    const s = saldos(
      [
        ['A', 5],
        ['B', 5],
      ],
      [],
    );
    expect(excesosDelRecibo([celda('A', 5), celda('B', 5)], s)).toEqual([]);
  });

  it('acumula por celda: dos capturas parciales del mismo pack agotan su saldo', () => {
    const s = saldos([['A', 10]], [['A', 7]]);
    expect(excesosDelRecibo([celda('A', 3)], s)).toEqual([]);
    // Con un solo pack las dos condiciones coinciden y las dos se quejan (ver arriba).
    expect(excesosDelRecibo([celda('A', 4)], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 4, disponible: 3 },
      { motivo: 'pack', idColor: COLOR, idTalla: TALLA, pack: 'A', pide: 4, disponible: 3 },
    ]);
  });

  // ── ⭐ V1 (fila 0.109) · EL TERCER SUMANDO DEL TOPE: lo ya SALDADO al cerrar la orden ──────────
  //
  // Estas tres pruebas existen porque el reviewer midió que sin ellas el sumando era LETRA MUERTA:
  // puso a cero `saldadoTotal`/`saldadoPorPack` en `excesosDelRecibo` y los 3,056 tests seguían en
  // verde. El tope tiene que restarlo: cerrar da por perdidas esas piezas, así que recibirlas
  // después las contaría DOS veces (el maquilero saldado Y la mercancía adentro).
  it('⭐ lo SALDADO consume saldo: cerradas las 40 que faltaban, ya no se pueden recibir', () => {
    const s = saldos([[SIN_PACK, 100]], [[SIN_PACK, 60]], [[SIN_PACK, 40]]);
    // Sin el cierre quedaban 40 recibibles; con él, cero.
    expect(excesosDelRecibo([celda(SIN_PACK, 1)], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 1, disponible: 0 },
    ]);
  });

  it('⭐ un cierre PARCIAL deja recibir el resto, y ni una pieza más', () => {
    const s = saldos([[SIN_PACK, 100]], [[SIN_PACK, 60]], [[SIN_PACK, 30]]);
    expect(excesosDelRecibo([celda(SIN_PACK, 10)], s)).toEqual([]);
    expect(excesosDelRecibo([celda(SIN_PACK, 11)], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: TALLA, pide: 11, disponible: 10 },
    ]);
  });

  it('⭐ lo SALDADO también topa POR PACK, no sólo al agregado', () => {
    // Enviadas 5 de A y 5 de B; el cierre saldó las 5 de A. El pack A no admite ni una; B sí.
    const s = saldos(
      [
        ['A', 5],
        ['B', 5],
      ],
      [],
      [['A', 5]],
    );
    expect(excesosDelRecibo([celda('A', 1)], s)).toEqual([
      { motivo: 'pack', idColor: COLOR, idTalla: TALLA, pack: 'A', pide: 1, disponible: 0 },
    ]);
    expect(excesosDelRecibo([celda('B', 5)], s)).toEqual([]);
  });

  it('celdas de tallas distintas NO se prestan saldo entre sí', () => {
    const s: SaldosDelRecibo = {
      enviadoPorPack: new Map([[claveCeldaPack(COLOR, TALLA, 'A'), 10]]),
      devueltoPorPack: new Map(),
      enviadoTotal: new Map([[`${COLOR}:${TALLA}`, 10]]),
      devueltoTotal: new Map(),
      saldadoPorPack: new Map(),
      saldadoTotal: new Map(),
    };
    // La talla 99 no tiene envío: no cabe nada, aunque la talla 3 tenga 10 libres.
    const otraTalla: CeldaRecibidaParaTope = {
      idColor: COLOR,
      idTalla: 99,
      pack: 'A',
      devuelveAhora: 1,
    };
    expect(excesosDelRecibo([otraTalla], s)).toEqual([
      { motivo: 'total', idColor: COLOR, idTalla: 99, pide: 1, disponible: 0 },
      { motivo: 'pack', idColor: COLOR, idTalla: 99, pack: 'A', pide: 1, disponible: 0 },
    ]);
  });

  it('el saldo por pack puede estar en 0 sin que el agregado lo esté, y se rechaza igual', () => {
    // Enviado A=5, B=5; ya devuelto A=5. Quedan 5 en total, pero NINGUNA de A.
    const s = saldos(
      [
        ['A', 5],
        ['B', 5],
      ],
      [['A', 5]],
    );
    expect(excesosDelRecibo([celda('A', 1)], s)).toEqual([
      { motivo: 'pack', idColor: COLOR, idTalla: TALLA, pack: 'A', pide: 1, disponible: 0 },
    ]);
    // …y las 5 que quedan sí se pueden recibir del pack B, o sin pack.
    expect(excesosDelRecibo([celda('B', 5)], s)).toEqual([]);
    expect(excesosDelRecibo([celda(SIN_PACK, 5)], s)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RE-EMPACAR UN COLOR YA EN PRODUCCIÓN (§Post-F9.10, C1)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// La regla se compara POR COLOR y no por renglón porque hay DOS caminos que re-empacan sin tocar un
// solo `id` de fila —borrar+recrear, y `copiarDetalleOrden`, que nunca manda ids—. El cableado de
// cada puerta se prueba contra Postgres en `ordenes.int.test.ts`; aquí se fija la aritmética.

const ROJO = 7;
const AZUL = 9;
/** Atajo: «packs por color» desde pares legibles `[idColor, pack]`. */
const mapa = (...filas: [number, string][]) =>
  packsPorColor(filas.map(([idColor, pack]) => ({ idColor, pack })));

describe('coloresReempacados', () => {
  it('sin cambios, no señala nada', () => {
    expect(
      coloresReempacados(mapa([ROJO, 'A'], [ROJO, 'B']), mapa([ROJO, 'A'], [ROJO, 'B'])),
    ).toEqual([]);
  });

  it('🔴 PONERLE packs a un color que no los tenía SÍ es re-empacar', () => {
    // Es la puerta A: de un renglón sin pack a dos tendidos. El corte quedó en `pack=''`.
    expect(coloresReempacados(mapa([ROJO, '']), mapa([ROJO, 'A'], [ROJO, 'B']))).toEqual([ROJO]);
  });

  it('🔴 QUITARLE los packs a un color también', () => {
    expect(coloresReempacados(mapa([ROJO, 'A'], [ROJO, 'B']), mapa([ROJO, '']))).toEqual([ROJO]);
  });

  it('🔴 cambiar la LETRA de un tendido también', () => {
    expect(coloresReempacados(mapa([ROJO, 'A']), mapa([ROJO, 'B']))).toEqual([ROJO]);
  });

  it('agregar un tendido a un color que ya los tenía es re-empacar', () => {
    expect(coloresReempacados(mapa([ROJO, 'A']), mapa([ROJO, 'A'], [ROJO, 'B']))).toEqual([ROJO]);
  });

  it('el mismo conjunto en otro orden NO es re-empacar (es un conjunto, no una lista)', () => {
    expect(
      coloresReempacados(mapa([ROJO, 'A'], [ROJO, 'B']), mapa([ROJO, 'B'], [ROJO, 'A'])),
    ).toEqual([]);
  });

  it('los espacios no fabrican un tendido nuevo', () => {
    expect(coloresReempacados(mapa([ROJO, 'A']), mapa([ROJO, ' A ']))).toEqual([]);
    expect(coloresReempacados(mapa([ROJO, '']), mapa([ROJO, '   ']))).toEqual([]);
  });

  it('un color QUITADO entero no cuenta (borrar ya se podía; no es lo que el pack rompe)', () => {
    expect(coloresReempacados(mapa([ROJO, 'A'], [AZUL, 'A']), mapa([AZUL, 'A']))).toEqual([]);
  });

  it('un color NUEVO no cuenta (no tiene producción que huerfanar)', () => {
    expect(coloresReempacados(mapa([ROJO, 'A']), mapa([ROJO, 'A'], [AZUL, 'B']))).toEqual([]);
  });

  it('señala SÓLO el color re-empacado, no a sus vecinos', () => {
    expect(
      coloresReempacados(mapa([ROJO, 'A'], [AZUL, 'A']), mapa([ROJO, 'B'], [AZUL, 'A'])),
    ).toEqual([ROJO]);
  });

  it('matriz vacía a los dos lados: nada que señalar', () => {
    expect(coloresReempacados(mapa(), mapa())).toEqual([]);
  });
});

describe('packsPorColor', () => {
  it('agrupa por color y colapsa los duplicados normalizados', () => {
    const m = packsPorColor([
      { idColor: ROJO, pack: 'A' },
      { idColor: ROJO, pack: ' A ' },
      { idColor: ROJO, pack: 'B' },
      { idColor: AZUL, pack: '' },
    ]);
    expect([...(m.get(ROJO) ?? [])].sort()).toEqual(['A', 'B']);
    expect([...(m.get(AZUL) ?? [])]).toEqual([SIN_PACK]);
  });
});
