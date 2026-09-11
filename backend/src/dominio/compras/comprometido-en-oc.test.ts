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

import {
  elSinColorSeLlevaLasHuerfanas,
  repartirComprometidoPorColor,
  type ComprometidoMaterial,
} from './comprometido-en-oc.js';

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
        { idColor: 7, cantidadAComprar: 45 },
        { idColor: 9, cantidadAComprar: 15 },
      ],
      comprometido({ 7: 45, 9: 10 }),
    );
    // Rojo si el reparto mezclara las cubetas: [55, 0] o [27.5, 27.5] serían el síntoma.
    expect(reparto.map((r) => r.enOc)).toEqual([45, 10]);
    // Nada vino del acervo sin color: los dos números salen de OC que SÍ dicen su color.
    expect(reparto.map((r) => r.desdeAcervoSinColor)).toEqual([0, 0]);
  });

  it('un color sin nada comprado recibe 0, no el total del material', () => {
    const reparto = repartirComprometidoPorColor(
      [
        { idColor: 7, cantidadAComprar: 45 },
        { idColor: 9, cantidadAComprar: 15 },
      ],
      comprometido({ 7: 45 }),
    );
    // 🔴 El valor que la pone ROJA: `[45, 45]` — leer el `enOc` del MATERIAL en cada fila, que es
    // justo el defecto que el tablero R7 evita sumando por material antes de cruzar.
    expect(reparto.map((r) => r.enOc)).toEqual([45, 0]);
  });

  it('sin nada comprometido, nadie tiene nada comprado', () => {
    expect(
      repartirComprometidoPorColor([{ idColor: 7, cantidadAComprar: 45 }], undefined).map(
        (r) => r.enOc,
      ),
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
      [{ idColor: null, cantidadAComprar: 45 }],
      comprometido({ sin: 300 }),
    );
    expect(reparto.map((r) => r.enOc)).toEqual([300]);
    // ⚠️ Y NO se marca como ambiguo: la fila pregunta lo mismo que el acervo responde.
    expect(reparto[0]!.desdeAcervoSinColor).toBe(0);
  });

  it('el renglón sin color se lleva el acervo aunque haya hermanos CON color', () => {
    const reparto = repartirComprometidoPorColor(
      [
        { idColor: 7, cantidadAComprar: 45 },
        { idColor: null, cantidadAComprar: 15 },
      ],
      comprometido({ 7: 20, sin: 300 }),
    );
    // El de color toma lo suyo (20); el acervo entero va al que hace la MISMA pregunta sin responder.
    expect(reparto.map((r) => r.enOc)).toEqual([20, 300]);
    expect(reparto.map((r) => r.desdeAcervoSinColor)).toEqual([0, 0]);
  });

  it('sin renglón sin color, el acervo se reparte por necesidad y el ÚLTIMO absorbe el resto', () => {
    const reparto = repartirComprometidoPorColor(
      [
        { idColor: 7, cantidadAComprar: 45 },
        { idColor: 9, cantidadAComprar: 15 },
      ],
      comprometido({ sin: 300 }),
    );
    // 45 al primero (lo que necesita) y el remanente al último: la Σ se conserva (45 + 255 = 300).
    expect(reparto.map((r) => r.enOc)).toEqual([45, 255]);
    expect(reparto.reduce((s, r) => s + r.enOc, 0)).toBe(300);
    // 🔴 Y los DOS números están marcados como venidos de una OC sin color: es lo que la
    // pantalla enseña para no pintar «ya en OC» como un hecho plano.
    expect(reparto.map((r) => r.desdeAcervoSinColor)).toEqual([45, 255]);
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
        { idColor: 7, cantidadAComprar: 100 },
        { idColor: 9, cantidadAComprar: 100 },
      ],
      insuficiente(),
    );
    const granaPrimero = repartirComprometidoPorColor(
      [
        { idColor: 9, cantidadAComprar: 100 },
        { idColor: 7, cantidadAComprar: 100 },
      ],
      insuficiente(),
    );
    expect(marinoPrimero.map((r) => r.enOc)).toEqual([100, 0]);
    expect(granaPrimero.map((r) => r.enOc)).toEqual([100, 0]);
    // 🔴 Y los 100 van MARCADOS como ambiguos en los dos casos: el valor que pondría roja esta
    // línea es un 0, o sea el sistema eligiendo en silencio.
    expect(marinoPrimero[0]!.desdeAcervoSinColor).toBe(100);
    expect(granaPrimero[0]!.desdeAcervoSinColor).toBe(100);
    // El que va PRIMERO se lleva los 100, sea cual sea el color: el sistema no sabe de quién eran.
    // La Σ se conserva en los dos casos — lo que cambia es a quién se le atribuye.
    expect(marinoPrimero.reduce((s, r) => s + r.enOc, 0)).toBe(100);
    expect(granaPrimero.reduce((s, r) => s + r.enOc, 0)).toBe(100);
  });
});

describe('⭐⭐ 0.158 — LAS CUBETAS HUÉRFANAS (el avío que se marca «sin color» con OC ya hecha)', () => {
  /**
   * ⭐⭐ **EL CASO DE DANIEL, EN LA FUNCIÓN PURA.** Un avío se compró por color (tres OC: Rojo 30,
   * Azul 50, Negro 20) y DESPUÉS alguien marca «se compra sin tomar en cuenta el color» (fila
   * 0.158). Desde ese momento la explosión emite **UN renglón sin color** y las tres cubetas se
   * quedan **sin dueño**.
   *
   * 🔴 **Antes de esta corrección se caían al piso**: el renglón sin color sólo miraba la cubeta
   * `null`, veía 0, y la explosión volvía a ofrecer las 100 piezas que ya estaban en una OC viva —
   * o sea §Post-F9.85 (*"no se vuelve a comprar lo ya comprado"*) resucitado por otra puerta. Si el
   * comprador generaba la OC, **se compraba dos veces**. El valor que pone ROJA la primera línea de
   * abajo es exactamente ese: `0`.
   */
  it('⭐ el renglón sin color absorbe las cubetas de color que NADIE reclama', () => {
    const reparto = repartirComprometidoPorColor(
      [{ idColor: null, cantidadAComprar: 100 }],
      comprometido({ 7: 30, 9: 50, 15: 20 }),
    );
    expect(reparto.map((r) => r.enOc)).toEqual([100]);
    // ⚠️ NO son ambiguas: la OC sí dice su color; el que no pregunta por color es el renglón, y
    // como pide TODO el material de la orden, esas líneas le corresponden enteras.
    expect(reparto[0]!.desdeAcervoSinColor).toBe(0);
  });

  it('⭐ suma las huérfanas Y el acervo sin color, sin contar dos veces', () => {
    const reparto = repartirComprometidoPorColor(
      [{ idColor: null, cantidadAComprar: 400 }],
      comprometido({ 7: 30, sin: 300 }),
    );
    // 🔴 Valores que la ponen roja: `300` (sólo el acervo, la conducta vieja) o `30` (sólo las
    // huérfanas). La invariante es que no se pierda NADA: 30 + 300.
    expect(reparto.map((r) => r.enOc)).toEqual([330]);
  });

  /**
   * 🔴 **EL CASO MIXTO: CON HERMANOS DE COLOR, EL SIN COLOR NO ABSORBE NADA.** Aquí el renglón sin
   * color es **una PARTE del material**, no todo, así que acreditarle una línea que la OC pidió de
   * otro tono le baja el faltante y ese material deja de comprarse.
   *
   * ⚠️ Los números están elegidos para que **no cuadren**: lo huérfano suma 80 y el renglón sin
   * color necesita 70. Con la versión anterior de esta prueba (huérfanas = 70, justo lo que el
   * renglón pedía) la absorción pasaba **por casualidad** y el defecto se escondía — fue el propio
   * reviewer quien lo cazó.
   */
  it('⭐ MIXTO: con hermanos CON color en la mesa, el sin color NO absorbe lo huérfano', () => {
    const reparto = repartirComprometidoPorColor(
      [
        { idColor: 7, cantidadAComprar: 30 },
        { idColor: null, cantidadAComprar: 70 },
      ],
      comprometido({ 7: 30, 9: 55, 15: 25 }),
    );
    // Rojo (7) conserva sus 30. Azul (9) y Negro (15) están huérfanas y se quedan SIN repartir.
    // 🔴 El valor que la pone roja: `[30, 80]` — el sin color acreditándose tonos ajenos y
    // quedándose en pendiente 0 con sus 70 sin comprar.
    expect(reparto.map((r) => r.enOc)).toEqual([30, 0]);
    expect(reparto.map((r) => r.desdeAcervoSinColor)).toEqual([0, 0]);
  });

  /**
   * ⭐⭐ **LA PRUEBA QUE FALTABA Y QUE HABRÍA CAZADO LA REGRESIÓN** (reviewer, 7-sep-2026). Es una
   * TELA, que es donde la premisa *"el renglón sin color pide todo el material"* se cae: los
   * colores de prenda **sin amarre de tono** caen en el grupo `'sin'` **junto a** los que sí lo
   * tienen (`mrp.ts`, armado de `grupos`), así que la misma tela emite renglones con color y uno
   * sin color a la vez. Es el estado normal mientras el comprador no captura los tonos.
   *
   * 🚪 **Y la cubeta huérfana tiene una puerta abierta que la fabrica:** cambiar el amarre de color
   * sólo se bloquea con `ESTATUS_OC_COMPROMETIDA`, que **no** incluye `borrador` (*"mientras la OC
   * sea un BORRADOR el color se mueve libre"*), pero `borrador` **sí** cuenta en
   * `ESTATUS_OC_QUE_CUBREN`, que es lo que alimenta este neteo. Un borrador + un cambio de tono y
   * la cubeta se queda sin dueño.
   *
   * 🔴 **El daño que fija esta prueba:** con la absorción sin acotar, los 80 m de la fila sin color
   * quedaban acreditados con 100 m que la OC pidió como **Vino** → `pendiente: 0` → **esos 80 m no
   * se compran nunca**. Una sub-compra silenciosa que para la producción, a cambio de evitar una
   * sobre-compra visible: mal negocio.
   */
  it('⭐⭐ TELA MIXTA: la cubeta de un tono que ya nadie usa NO le tapa el faltante al sin color', () => {
    const GRIS = 3;
    const MARINO = 4;
    const VINO = 9; // el tono que la OC borrador pidió y que ya ningún renglón reclama
    const reparto = repartirComprometidoPorColor(
      [
        { idColor: GRIS, cantidadAComprar: 60 },
        { idColor: MARINO, cantidadAComprar: 90 },
        { idColor: null, cantidadAComprar: 80 }, // el color de prenda que aún no tiene amarre
      ],
      comprometido({ [VINO]: 100, [MARINO]: 100 }),
    );
    // Marino cobra lo suyo; Gris no tiene nada comprado; y el sin color **sigue debiendo sus 80**.
    // 🔴 El valor que la pone roja: un `100` en la tercera posición — los 80 m que se dejarían de
    // comprar, pagados con una línea de Vino.
    expect(reparto.map((r) => r.enOc)).toEqual([0, 100, 0]);
  });

  /**
   * 🔑 **LA INVARIANTE, ACOTADA A DONDE VALE.** Sólo cuando el renglón sin color es el **ÚNICO** del
   * material puede decirse que nada de lo comprometido se queda sin contar — ahí sí pide toda la
   * orden. Enunciarla para cualquier mesa con un renglón sin color (como estaba antes) es lo que
   * justificaba absorber en el caso mixto y metía la regresión de telas.
   */
  it('🔑 con el sin color como ÚNICO renglón, la Σ repartida es TODO lo comprometido', () => {
    const cubetas = comprometido({ 7: 30, 9: 50, 15: 20, sin: 12.5 });
    const reparto = repartirComprometidoPorColor(
      [{ idColor: null, cantidadAComprar: 112.5 }],
      cubetas,
    );
    expect(reparto.reduce((s, r) => s + r.enOc, 0)).toBe(cubetas.enOc);
  });

  /**
   * 🔴 **LA OTRA MITAD, LA QUE IMPIDE ARREGLAR DE MÁS.** Sin un renglón sin color, una cubeta
   * huérfana **NO se reparte**: darle a Azul lo que una OC pidió para Rojo sería inventar un hecho,
   * que es justo la suposición-escrita-como-dato que §Post-F9.86 prohíbe. El acervo `null` sí se
   * reparte, porque ahí la OC no dice nada; una línea que SÍ dice "Rojo" no se le atribuye a otro.
   *
   * Sin esta prueba, «que el huérfano se lo lleve alguien» pasaría igual de verde.
   */
  it('⭐ SIN renglón sin color, la huérfana NO se le atribuye a otro color', () => {
    const reparto = repartirComprometidoPorColor(
      [
        { idColor: 7, cantidadAComprar: 30 },
        { idColor: 9, cantidadAComprar: 50 },
      ],
      comprometido({ 7: 30, 9: 50, 15: 20 }),
    );
    // Negro (15) está huérfano y se queda sin repartir: cada quien con lo suyo, 20 sin dueño.
    expect(reparto.map((r) => r.enOc)).toEqual([30, 50]);
    expect(reparto.map((r) => r.desdeAcervoSinColor)).toEqual([0, 0]);
  });
});

/**
 * ⭐⭐ **LA GUARDA, UNA SOLA** (fila 0.158; sacada a función compartida en la ⭐⭐ fila 0.162).
 *
 * La misma regla gobierna TRES caminos —lo comprometido en OC, lo dado por cubierto
 * (`repartirCubiertoPorColor`) y **deshacer** (`darPorCubierto` con `cubierto: false`)—, y en
 * `darPorCubierto` los dos primeros reciben **el mismo grupo de hermanos**: con dos copias podrían
 * contestar distinto sobre las mismas filas. Estas aserciones fijan la copia única.
 */
describe('elSinColorSeLlevaLasHuerfanas — la guarda que comparten los tres caminos', () => {
  it('sólo cuando el renglón sin color es el ÚNICO del material', () => {
    expect(elSinColorSeLlevaLasHuerfanas([{ idColor: null }])).toBe(true);
    expect(elSinColorSeLlevaLasHuerfanas([{ idColor: null }, { idColor: 7 }])).toBe(false);
    expect(elSinColorSeLlevaLasHuerfanas([{ idColor: 7 }])).toBe(false);
    // Sin renglones no hay nadie que absorba (y `every` sobre vacío diría que sí).
    expect(elSinColorSeLlevaLasHuerfanas([])).toBe(false);
  });
});
