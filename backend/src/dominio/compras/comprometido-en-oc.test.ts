/**
 * ⭐⭐ **A QUÉ RENGLÓN LE CUBRE CADA LÍNEA DE OC** (V1-E3u, §Post-F9.89) — pruebas de
 * `repartirComprometidoPorColor`, función PURA.
 *
 * 🔴 **Por qué merece batería propia:** es la función sobre la que descansa TODO el *"los datos
 * viejos no se rompen"* de la etapa. Desde §Post-F9.89 un renglón de explosión es *(tela, color)*,
 * pero las ~7,978 OC migradas piden *(tela)* a secas. Si el neteo casara sólo por color exacto, cada
 * OC anterior a la etapa dejaría de contar y la explosión **volvería a ofrecer comprar lo ya
 * comprado** — el defecto exacto que §Post-F9.85 cerró, resucitado en silencio.
 */
import { describe, expect, it } from 'vitest';

import { repartirComprometidoPorColor, type ComprometidoMaterial } from './comprometido-en-oc.js';

/** Arma un `ComprometidoMaterial` con las cubetas por color indicadas (`null` = acervo sin color). */
function comprometido(porColor: Record<string, number>): ComprometidoMaterial {
  const mapa = new Map<number | null, { enOc: number; recibido: number }>();
  for (const [clave, enOc] of Object.entries(porColor)) {
    mapa.set(clave === 'sin' ? null : Number(clave), { enOc, recibido: 0 });
  }
  return {
    enOc: Object.values(porColor).reduce((s, v) => s + v, 0),
    recibido: 0,
    material: 'Felpa 280',
    idTela: 1,
    idAvio: null,
    porColor: mapa,
  };
}

describe('repartirComprometidoPorColor — cada color se queda con LO SUYO', () => {
  it('cada renglón toma la cubeta de SU color, y no la del vecino', () => {
    const reparto = repartirComprometidoPorColor(
      [
        { idTelaColor: 7, cantidadAComprar: 45 },
        { idTelaColor: 9, cantidadAComprar: 15 },
      ],
      comprometido({ 7: 45, 9: 10 }),
    );
    // Rojo si el reparto mezclara las cubetas: [55, 0] o [27.5, 27.5] serían el síntoma.
    expect(reparto).toEqual([45, 10]);
  });

  it('un color sin nada comprado recibe 0, no el total del material', () => {
    const reparto = repartirComprometidoPorColor(
      [
        { idTelaColor: 7, cantidadAComprar: 45 },
        { idTelaColor: 9, cantidadAComprar: 15 },
      ],
      comprometido({ 7: 45 }),
    );
    // 🔴 El valor que la pone ROJA: `[45, 45]` — leer el `enOc` del MATERIAL en cada fila, que es
    // justo el defecto que el tablero R7 evita sumando por material antes de cruzar.
    expect(reparto).toEqual([45, 0]);
  });

  it('sin nada comprometido, nadie tiene nada comprado', () => {
    expect(
      repartirComprometidoPorColor([{ idTelaColor: 7, cantidadAComprar: 45 }], undefined),
    ).toEqual([0]);
  });

  it('sin renglones no hay reparto', () => {
    expect(repartirComprometidoPorColor([], comprometido({ sin: 300 }))).toEqual([]);
  });
});

describe('repartirComprometidoPorColor — EL ACERVO SIN COLOR (lo migrado)', () => {
  /**
   * 🔴 **LA NO-REGRESIÓN DE LAS ~7,978 OC MIGRADAS.** Antes de la etapa, `comprometidoDe` devolvía
   * el total del material tal cual. Con un solo renglón sin color —el caso de toda orden anterior a
   * §Post-F9.89— esta función tiene que devolver **exactamente lo mismo**.
   *
   * Valor que la pone ROJA: `[45]` (recortar al necesitado, dejando 255 sin contar). El tablero
   * diría *"ya en OC: 45"* donde el documento dice 300, y la explosión ofrecería comprar 255 de una
   * tela que ya está comprada.
   */
  it('un renglón SIN color se lleva el acervo COMPLETO (cero regresión en lo migrado)', () => {
    const reparto = repartirComprometidoPorColor(
      [{ idTelaColor: null, cantidadAComprar: 45 }],
      comprometido({ sin: 300 }),
    );
    expect(reparto).toEqual([300]);
  });

  it('el renglón sin color se lleva el acervo aunque haya hermanos CON color', () => {
    const reparto = repartirComprometidoPorColor(
      [
        { idTelaColor: 7, cantidadAComprar: 45 },
        { idTelaColor: null, cantidadAComprar: 15 },
      ],
      comprometido({ 7: 20, sin: 300 }),
    );
    // El de color toma lo suyo (20); el acervo entero va al que hace la MISMA pregunta sin responder.
    expect(reparto).toEqual([20, 300]);
  });

  it('sin renglón sin color, el acervo se reparte por necesidad y el ÚLTIMO absorbe el resto', () => {
    const reparto = repartirComprometidoPorColor(
      [
        { idTelaColor: 7, cantidadAComprar: 45 },
        { idTelaColor: 9, cantidadAComprar: 15 },
      ],
      comprometido({ sin: 300 }),
    );
    // 45 al primero (lo que necesita) y el remanente al último: la Σ se conserva (45 + 255 = 300).
    expect(reparto).toEqual([45, 255]);
    expect(reparto.reduce((s, v) => s + v, 0)).toBe(300);
  });

  /**
   * 🔴 **LA AMBIGÜEDAD IRREDUCIBLE, ESCRITA COMO PRUEBA** (D5 de la revisión). Con acervo
   * INSUFICIENTE, **el orden de los renglones decide a quién le toca**, y eso NO se puede resolver
   * bien: la OC vieja no dice de qué color era, y adivinarlo escribiría como HECHO una suposición
   * (la lección de §Post-F9.86).
   *
   * Esta prueba **no bendice** el resultado: lo FIJA, para que quede claro que el sistema está
   * eligiendo y que por eso la pantalla tiene que avisarlo (`ExplosionMaterialesPagina`, chip
   * "de una OC sin color"). Si algún día se decide repartir a prorrata, esta prueba es la que
   * obliga a decidirlo a propósito en vez de cambiarlo sin querer.
   */
  it('🔴 con acervo INSUFICIENTE el primero se lo lleva: es una elección, no un cálculo', () => {
    const insuficiente = () => comprometido({ sin: 100 });
    const marinoPrimero = repartirComprometidoPorColor(
      [
        { idTelaColor: 7, cantidadAComprar: 100 },
        { idTelaColor: 9, cantidadAComprar: 100 },
      ],
      insuficiente(),
    );
    const granaPrimero = repartirComprometidoPorColor(
      [
        { idTelaColor: 9, cantidadAComprar: 100 },
        { idTelaColor: 7, cantidadAComprar: 100 },
      ],
      insuficiente(),
    );
    expect(marinoPrimero).toEqual([100, 0]);
    expect(granaPrimero).toEqual([100, 0]);
    // El que va PRIMERO se lleva los 100, sea cual sea el color: el sistema no sabe de quién eran.
    // La Σ se conserva en los dos casos — lo que cambia es a quién se le atribuye.
    expect(marinoPrimero.reduce((s, v) => s + v, 0)).toBe(100);
    expect(granaPrimero.reduce((s, v) => s + v, 0)).toBe(100);
  });
});
