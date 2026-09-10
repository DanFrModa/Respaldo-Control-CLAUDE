/**
 * Pruebas del EMBUDO de la comparación horizontal ({@link compararConHermanas}), que es donde vive
 * la regla entera de la fila 0.068 (a). Es PURA: se prueba sin Postgres.
 *
 * ⚠️ Cada bloque lleva su **control negativo** — el caso en el que la regla NO debe disparar—,
 * porque una prueba que sólo mira el caso positivo pasa igual con el aviso encendido siempre.
 */
import { describe, expect, it } from 'vitest';

import {
  compararConHermanas,
  type MaterialDeLaOp,
  type OrdenParaComparar,
} from './hermanas-de-la-op.js';

// ── Constructores del fixture ─────────────────────────────────────────────────────────────

function tela(idTela: number, consumo: number, nombre = `Tela ${String(idTela)}`): MaterialDeLaOp {
  return {
    tipo: 'tela',
    clave: `tela-${String(idTela)}`,
    nombre,
    consumoPorPrenda: consumo,
    porTalla: false,
    medidas: new Map(),
  };
}

/** Etiquetas de prueba por id de talla (1=CH, 2=M, 3=G…). */
const ETIQUETAS: Record<number, string> = { 1: 'CH', 2: 'M', 3: 'G', 7: 'XG' };

/**
 * ⚠️ **`orden` (la escala canónica) por defecto NO es el id**, y eso es deliberado: con
 * `orden = idTalla` cualquier prueba de ordenamiento pasaría **por construcción del fixture** —da
 * igual si el código ordena por uno o por el otro—. Aquí la escala va al REVÉS del id, así que las
 * dos hipótesis producen textos distintos y la prueba puede fallar.
 */
const ESCALA: Record<number, number> = { 1: 100, 2: 90, 3: 80, 7: 10 };

function avio(
  idAvio: number,
  consumo: number,
  extra: { porTalla?: boolean; medidas?: [number, number][]; nombre?: string } = {},
): MaterialDeLaOp {
  return {
    tipo: 'avio',
    clave: `avio-${String(idAvio)}`,
    nombre: extra.nombre ?? `AV-${String(idAvio)} — Avío ${String(idAvio)}`,
    consumoPorPrenda: consumo,
    porTalla: extra.porTalla ?? false,
    medidas: new Map(
      (extra.medidas ?? []).map(([idTalla, valor]) => [
        idTalla,
        {
          consumo: valor,
          etiqueta: ETIQUETAS[idTalla] ?? `T${String(idTalla)}`,
          orden: ESCALA[idTalla] ?? idTalla,
        },
      ]),
    ),
  };
}

function arte(clave: string, nombre = clave): MaterialDeLaOp {
  return {
    tipo: 'arte',
    clave,
    nombre,
    consumoPorPrenda: null,
    porTalla: false,
    medidas: new Map(),
  };
}

function op(
  idOrden: number,
  materiales: MaterialDeLaOp[],
  extra: { idLinaje?: number; tieneReceta?: boolean; escritaPorLaMigracion?: boolean } = {},
): OrdenParaComparar {
  return {
    idOrden,
    folio: 5000 + idOrden,
    idLinaje: extra.idLinaje ?? 1,
    materiales,
    tieneReceta: extra.tieneReceta ?? materiales.length > 0,
    escritaPorLaMigracion: extra.escritaPorLaMigracion ?? false,
  };
}

/** Una OP HISTÓRICA: su receta la congeló el ETL con el BOM del día de la carga. */
function historica(idOrden: number, materiales: MaterialDeLaOp[]): OrdenParaComparar {
  return op(idOrden, materiales, { escritaPorLaMigracion: true });
}

/**
 * Una OP histórica **a la que le quitaron un renglón** (la jareta). El renglón queda como lápida
 * `ajustado` ⇒ deja de estar en `materiales` (no lo lleva) y **la orden vuelve al grupo**, porque
 * quitarlo es una decisión de una persona. Es lo que resuelve el cargador al ver la lápida.
 */
function historicaConJareta(idOrden: number, materiales: MaterialDeLaOp[]): OrdenParaComparar {
  return op(idOrden, materiales, { escritaPorLaMigracion: false });
}

// ── El caso de Daniel ─────────────────────────────────────────────────────────────────────

describe('el cierre de la café — una OP del grupo lleva un avío distinto', () => {
  /** Tres hermanas con el cierre 10 y la cuarta (la café) con el 11. */
  const familia = (): OrdenParaComparar[] => [
    op(1, [tela(7, 1.5), avio(10, 1, { nombre: 'CIE-01 — Cierre negro' })]),
    op(2, [tela(7, 1.5), avio(10, 1, { nombre: 'CIE-01 — Cierre negro' })]),
    op(3, [tela(7, 1.5), avio(10, 1, { nombre: 'CIE-01 — Cierre negro' })]),
    op(4, [tela(7, 1.5), avio(11, 1, { nombre: 'CIE-02 — Cierre café' })]),
  ];

  it('avisa SÓLO a la que se desvía, y le dice QUÉ lleva distinto', () => {
    const r = compararConHermanas(familia());
    const cuarta = r.get(4);
    expect(cuarta?.aviso).toContain('no va igual que sus 3 hermanas');
    expect(cuarta?.aviso).toContain('CIE-02 — Cierre café');
    expect(cuarta?.aviso).toContain('CIE-01 — Cierre negro');
    expect(cuarta?.hermanas).toBe(3);
    expect(cuarta?.foliosHermanas).toEqual([5001, 5002, 5003]);
    // Dos diferencias: el que lleva de más y el que le falta.
    expect(cuarta?.diferencias.map((d) => d.que).sort()).toEqual(['no-la-lleva', 'solo-esta']);
    const soloEsta = cuarta?.diferencias.find((d) => d.que === 'solo-esta');
    expect(soloEsta?.detalle).toBe(
      '«CIE-02 — Cierre café»: esta OP lleva 1 · OP 5001, 5002, 5003 no lo llevan.',
    );
    const leFalta = cuarta?.diferencias.find((d) => d.que === 'no-la-lleva');
    expect(leFalta?.detalle).toBe(
      '«CIE-01 — Cierre negro»: esta OP no lo lleva · OP 5001, 5002, 5003 llevan 1.',
    );
  });

  it('🔴 CONTROL NEGATIVO: las TRES que van igual NO reciben aviso', () => {
    const r = compararConHermanas(familia());
    for (const id of [1, 2, 3]) {
      expect(r.get(id)?.aviso).toBeNull();
      expect(r.get(id)?.diferencias).toEqual([]);
      // Pero sí saben que tienen hermanas: el silencio no es «no hay grupo».
      expect(r.get(id)?.hermanas).toBe(3);
    }
  });

  it('🔴 CONTROL NEGATIVO: si las cuatro llevan lo mismo, NADIE recibe aviso', () => {
    const iguales = familia().map((o) =>
      o.idOrden === 4 ? op(4, [tela(7, 1.5), avio(10, 1, { nombre: 'CIE-01 — Cierre negro' })]) : o,
    );
    const r = compararConHermanas(iguales);
    expect([...r.values()].every((f) => f.aviso === null)).toBe(true);
  });
});

// ── La jareta: un renglón EXCLUIDO es «no lo lleva» ───────────────────────────────────────

describe('la jareta — la OP que le quitó un material que sus hermanas sí llevan', () => {
  it('avisa a la que le falta (el excluido llega como material ausente)', () => {
    const r = compararConHermanas([
      op(1, [tela(7, 1.5), avio(20, 1, { nombre: 'JAR-01 — Jareta' })]),
      op(2, [tela(7, 1.5), avio(20, 1, { nombre: 'JAR-01 — Jareta' })]),
      op(3, [tela(7, 1.5)]), // la jareta se excluyó en ESTA orden
    ]);
    expect(r.get(3)?.diferencias).toEqual([
      {
        tipo: 'avio',
        material: 'JAR-01 — Jareta',
        que: 'no-la-lleva',
        detalle: '«JAR-01 — Jareta»: esta OP no lo lleva · OP 5001, 5002 llevan 1.',
      },
    ]);
    expect(r.get(1)?.aviso).toBeNull();
    expect(r.get(2)?.aviso).toBeNull();
  });
});

// ── Cantidades ────────────────────────────────────────────────────────────────────────────

describe('la CANTIDAD congelada', () => {
  it('avisa cuando el consumo por prenda difiere', () => {
    const r = compararConHermanas([
      op(1, [tela(7, 1.5)]),
      op(2, [tela(7, 1.5)]),
      op(3, [tela(7, 2)]),
    ]);
    expect(r.get(3)?.diferencias[0]).toMatchObject({ que: 'cantidad', tipo: 'tela' });
    expect(r.get(3)?.diferencias[0]?.detalle).toBe(
      '«Tela 7»: esta OP lleva 2 · OP 5001, 5002 llevan 1.5.',
    );
    expect(r.get(1)?.aviso).toBeNull();
  });

  it('🔴 CONTROL NEGATIVO: una diferencia por debajo de la escala guardada (4 decimales) NO cuenta', () => {
    // `Decimal(12,4)` no puede guardar la diferencia, así que avisarla sería inventar un cambio.
    const r = compararConHermanas([op(1, [tela(7, 1.5)]), op(2, [tela(7, 1.5 + 1e-9)])]);
    expect(r.get(1)?.aviso).toBeNull();
    expect(r.get(2)?.aviso).toBeNull();
  });

  it('avisa cuando cambia el MODO de captura (por talla vs. por prenda)', () => {
    const r = compararConHermanas([
      op(1, [avio(30, 2, { porTalla: false })]),
      op(2, [avio(30, 2, { porTalla: false })]),
      op(3, [avio(30, 2, { porTalla: true, medidas: [[1, 2]] })]),
    ]);
    expect(r.get(3)?.diferencias[0]?.que).toBe('cantidad');
    // El texto distingue los DOS modos de captura, y nombra la talla en el que la tiene.
    expect(r.get(3)?.diferencias[0]?.detalle).toBe(
      '«AV-30 — Avío 30»: esta OP lleva 2 por talla (CH 2) · OP 5001, 5002 llevan 2.',
    );
    expect(r.get(1)?.aviso).toBeNull();
  });

  it('🔴 el DETALLE nombra las tallas y sus cantidades — los dos lados NO pueden decir lo mismo', () => {
    /*
     * El defecto que esto cierra: el mapa por talla iba a la FIRMA pero nunca al TEXTO, así que el
     * aviso decía *«esta OP lleva 1 por talla · OP 5001, 5002 llevan 1 por talla»* — dos frases
     * idénticas afirmando que hay una diferencia. Un aviso así se lee como un defecto, y además
     * incumple el propósito del módulo: no obligar a comparar a mano.
     */
    const r = compararConHermanas([
      op(1, [
        avio(30, 1, {
          porTalla: true,
          medidas: [
            [1, 2],
            [2, 3],
          ],
          nombre: 'AV-30 — Elástico',
        }),
      ]),
      op(2, [
        avio(30, 1, {
          porTalla: true,
          medidas: [
            [1, 2],
            [2, 3],
          ],
          nombre: 'AV-30 — Elástico',
        }),
      ]),
      op(3, [
        avio(30, 1, {
          porTalla: true,
          medidas: [
            [1, 2],
            [2, 9],
          ],
          nombre: 'AV-30 — Elástico',
        }),
      ]),
    ]);
    const detalle = r.get(3)?.diferencias[0]?.detalle;
    expect(detalle).toBe(
      '«AV-30 — Elástico»: esta OP lleva 1 por talla (M 9 · CH 2) · OP 5001, 5002 llevan 1 por talla (M 3 · CH 2).',
    );
    // Y las dos mitades de la frase son DISTINTAS (lo que fallaba antes).
    const [mia, otras] = (detalle ?? '').split(' · OP ');
    expect(mia).not.toBe(`5001, 5002 llevan${(otras ?? '').replace(/^5001, 5002 llevan/, '')}`);
    expect(detalle).toContain('M 9');
    expect(detalle).toContain('M 3');
  });

  it('🔴 EL OTRO CUADRANTE: mismo mapa por talla y distinto consumo POR PRENDA — el detalle lo dice', () => {
    /*
     * El mismo defecto de la ronda anterior en el cuadrante contrario: el texto llevaba las medidas
     * pero **había perdido la cifra por prenda**, mientras la firma sí la lleva. Dos OP con el
     * MISMO mapa y distinto `consumoPorPrenda` —dato real: lo copia el ETL y lo edita
     * `editarRenglonReceta`— salían con las dos mitades de la frase idénticas.
     */
    const medidas: [number, number][] = [
      [1, 5],
      [2, 6],
    ];
    const r = compararConHermanas([
      op(1, [avio(30, 1, { porTalla: true, medidas, nombre: 'AV-30 — Elástico' })]),
      op(2, [avio(30, 1, { porTalla: true, medidas, nombre: 'AV-30 — Elástico' })]),
      op(3, [avio(30, 9, { porTalla: true, medidas, nombre: 'AV-30 — Elástico' })]),
    ]);
    expect(r.get(3)?.diferencias[0]?.detalle).toBe(
      '«AV-30 — Elástico»: esta OP lleva 9 por talla (M 6 · CH 5) · OP 5001, 5002 llevan 1 por talla (M 6 · CH 5).',
    );
    expect(r.get(1)?.aviso).toBeNull();
  });

  it('🔴 las tallas se nombran en la ESCALA canónica, NO por id de talla', () => {
    /*
     * El fixture pone la escala al REVÉS del id (`ESCALA`): M (id 2, orden 90) va ANTES que CH
     * (id 1, orden 100). Si el código ordenara por id saldría «CH 2 · M 3» y esto fallaría — que es
     * lo que lo separa de una prueba que pasa por construcción.
     */
    const r = compararConHermanas([
      op(1, [
        avio(30, 1, {
          porTalla: true,
          medidas: [
            [1, 2],
            [2, 3],
          ],
        }),
      ]),
      op(2, [
        avio(30, 1, {
          porTalla: true,
          medidas: [
            [1, 2],
            [2, 9],
          ],
        }),
      ]),
    ]);
    expect(r.get(1)?.diferencias[0]?.detalle).toContain('(M 3 · CH 2)');
  });

  it('avisa cuando difiere una MEDIDA por talla que todas comparten', () => {
    const medidas = (xg: number): [number, number][] => [
      [1, 1],
      [2, xg],
    ];
    const r = compararConHermanas([
      op(1, [avio(30, 1, { porTalla: true, medidas: medidas(2) })]),
      op(2, [avio(30, 1, { porTalla: true, medidas: medidas(2) })]),
      op(3, [avio(30, 1, { porTalla: true, medidas: medidas(3) })]),
    ]);
    expect(r.get(3)?.diferencias[0]?.que).toBe('cantidad');
    expect(r.get(1)?.aviso).toBeNull();
  });

  it('🔴 CONTROL NEGATIVO: una talla que sólo una hermana tiene NO es una diferencia de receta', () => {
    // Curvas distintas = diferencia del PEDIDO, no de la receta: se compara sólo lo común.
    const r = compararConHermanas([
      op(1, [
        avio(30, 1, {
          porTalla: true,
          medidas: [
            [1, 1],
            [2, 2],
          ],
        }),
      ]),
      op(2, [
        avio(30, 1, {
          porTalla: true,
          medidas: [
            [1, 1],
            [3, 9],
          ],
        }),
      ]),
    ]);
    expect(r.get(1)?.aviso).toBeNull();
    expect(r.get(2)?.aviso).toBeNull();
  });
});

// ── El ARTE: sólo presencia, nunca cantidad ───────────────────────────────────────────────

describe('el ARTE — la gemela sin cantidad', () => {
  it('avisa cuando una OP lleva un arte que sus hermanas no', () => {
    const r = compararConHermanas([
      op(1, [arte('arte-m-4', 'Bordado pecho')]),
      op(2, [arte('arte-m-4', 'Bordado pecho')]),
      op(3, [
        arte('arte-m-4', 'Bordado pecho'),
        arte('arte-d-etiqueta especial', 'Etiqueta especial'),
      ]),
    ]);
    expect(r.get(3)?.diferencias).toEqual([
      {
        tipo: 'arte',
        material: 'Etiqueta especial',
        que: 'solo-esta',
        detalle: '«Etiqueta especial»: esta OP lo lleva · OP 5001, 5002 no lo llevan.',
      },
    ]);
    expect(r.get(1)?.aviso).toBeNull();
  });

  it('🔴 dos artes agregados a mano con la MISMA descripción no cuentan dos veces', () => {
    // Misma clave dentro de una orden: se queda uno. **Sin el dedupe la mayoría se voltea**: la 1
    // aparecería DOS veces en su cubo (2 vs 2), habría empate, no habría norma y se encenderían las
    // tres — en vez de la única que de verdad se desvía.
    const r = compararConHermanas([
      op(1, [arte('arte-d-tag', 'Tag'), arte('arte-d-tag', 'Tag')]),
      op(2, [], { tieneReceta: true }),
      op(3, [], { tieneReceta: true }),
    ]);
    expect(r.get(2)?.aviso).toBeNull();
    expect(r.get(3)?.aviso).toBeNull();
    expect(r.get(1)?.diferencias).toEqual([
      {
        tipo: 'arte',
        material: 'Tag',
        que: 'solo-esta',
        detalle: '«Tag»: esta OP lo lleva · OP 5002, 5003 no lo llevan.',
      },
    ]);
  });
});

// ── Empates: cuando NO hay una norma ──────────────────────────────────────────────────────

describe('cuando no hay una norma, se avisa a TODAS', () => {
  it('2 vs 2 enciende las cuatro (callar escondería un grupo partido)', () => {
    const r = compararConHermanas([
      op(1, [tela(7, 1)]),
      op(2, [tela(7, 1)]),
      op(3, [tela(7, 2)]),
      op(4, [tela(7, 2)]),
    ]);
    for (const id of [1, 2, 3, 4]) {
      expect(r.get(id)?.aviso).not.toBeNull();
    }
    expect(r.get(1)?.diferencias[0]?.detalle).toBe(
      '«Tela 7»: esta OP lleva 1 · OP 5003, 5004 llevan 2.',
    );
  });

  it('dos hermanas que no coinciden encienden las dos', () => {
    const r = compararConHermanas([op(1, [tela(7, 1)]), op(2, [tela(7, 2)])]);
    expect(r.get(1)?.aviso).toContain('no va igual que su hermana');
    expect(r.get(2)?.aviso).toContain('no va igual que su hermana');
    // Singular, resuelto por el servidor.
    expect(r.get(1)?.diferencias[0]?.detalle).toBe('«Tela 7»: esta OP lleva 1 · OP 5002 lleva 2.');
  });
});

// ── Quién NO es hermana ───────────────────────────────────────────────────────────────────

describe('el universo comparado', () => {
  it('🔴 dos LINAJES distintos no se mezclan: cada OP se compara sólo con las suyas', () => {
    const r = compararConHermanas([
      op(1, [tela(7, 1)], { idLinaje: 100 }),
      op(2, [tela(7, 1)], { idLinaje: 100 }),
      // Otro linaje, con una receta completamente distinta: no debe manchar a las de arriba.
      op(3, [tela(9, 5)], { idLinaje: 200 }),
      op(4, [tela(9, 5)], { idLinaje: 200 }),
    ]);
    expect([...r.values()].every((f) => f.aviso === null)).toBe(true);
    expect(r.get(1)?.hermanas).toBe(1);
    expect(r.get(1)?.foliosHermanas).toEqual([5002]);
    expect(r.get(3)?.foliosHermanas).toEqual([5004]);
  });

  it('una OP sola no tiene con quién compararse', () => {
    const r = compararConHermanas([op(1, [tela(7, 1)])]);
    expect(r.get(1)).toEqual({
      hermanas: 0,
      foliosHermanas: [],
      fueraDeLaComparacion: 0,
      diferencias: [],
      aviso: null,
      notaFueraDeLaComparacion: null,
    });
  });

  it('🔴 la OP SIN receta congelada (histórico) ni compara ni se compara, y se CUENTA', () => {
    const r = compararConHermanas([
      op(1, [tela(7, 1)]),
      op(2, [tela(7, 1)]),
      op(3, [], { tieneReceta: false }),
    ]);
    // La vieja no dispara «no lleva nada» contra sus hermanas...
    expect(r.get(3)?.aviso).toBeNull();
    expect(r.get(3)?.diferencias).toEqual([]);
    expect(r.get(3)?.fueraDeLaComparacion).toBe(0);
    // ...ni las hermanas la ven como una que «no lleva» la tela.
    expect(r.get(1)?.aviso).toBeNull();
    expect(r.get(1)?.hermanas).toBe(1);
    // Pero la exclusión NO es silenciosa.
    expect(r.get(1)?.fueraDeLaComparacion).toBe(1);
  });

  it('una OP con receta cuyos renglones están TODOS excluidos sí compara (no es histórico)', () => {
    const r = compararConHermanas([
      op(1, [tela(7, 1)]),
      op(2, [tela(7, 1)]),
      op(3, [], { tieneReceta: true }),
    ]);
    expect(r.get(3)?.diferencias[0]?.que).toBe('no-la-lleva');
    expect(r.get(3)?.fueraDeLaComparacion).toBe(0);
  });
});

// ── 🔴🔴 D1: el histórico NO vota ─────────────────────────────────────────────────────────

describe('el histórico migrado no vota (si votara, el aviso saldría al revés)', () => {
  /**
   * EL CASO QUE MOTIVA LA REGLA. Un modelo con 3 OP históricas —las tres con la MISMA copia del
   * BOM, la del día del ETL— y 1 OP nueva creada después de que el BOM ganó un avío. Sin la
   * exclusión hay mayoría 3-a-1 y **la señalada sería la nueva**, que es la correcta: el aviso
   * diría lo contrario de lo que Daniel pidió.
   */
  const conElAvioNuevo = (): MaterialDeLaOp[] => [tela(7, 1.5), avio(10, 1), avio(11, 1)];
  const comoEstabaEnElEtl = (): MaterialDeLaOp[] => [tela(7, 1.5), avio(10, 1)];

  it('⭐ tres históricas NO señalan a la OP nueva', () => {
    const r = compararConHermanas([
      historica(1, comoEstabaEnElEtl()),
      historica(2, comoEstabaEnElEtl()),
      historica(3, comoEstabaEnElEtl()),
      op(4, conElAvioNuevo()),
    ]);
    expect(r.get(4)?.aviso).toBeNull();
    expect(r.get(4)?.diferencias).toEqual([]);
    // La nueva se quedó sin hermanas comparables, y el sistema LO DICE.
    expect(r.get(4)?.hermanas).toBe(0);
    expect(r.get(4)?.fueraDeLaComparacion).toBe(3);
    expect(r.get(4)?.notaFueraDeLaComparacion).toContain('3 OP del modelo quedaron fuera');
  });

  it('🔴 CONTROL: con las MISMAS recetas, si las históricas votaran la nueva saldría señalada', () => {
    // Idéntico al de arriba salvo la marca. Si la regla se relaja, esto se pone verde y el de
    // arriba rojo: los dos juntos fijan que lo único que cambia el resultado es la marca del ETL.
    const r = compararConHermanas([
      op(1, comoEstabaEnElEtl()),
      op(2, comoEstabaEnElEtl()),
      op(3, comoEstabaEnElEtl()),
      op(4, conElAvioNuevo()),
    ]);
    expect(r.get(4)?.aviso).not.toBeNull();
    expect(r.get(4)?.diferencias[0]).toMatchObject({ que: 'solo-esta' });
    expect(r.get(1)?.aviso).toBeNull();
  });

  it('🔴 una receta MIXTA vota: basta que UN renglón lo haya tocado una persona', () => {
    /*
     * `escritaPorLaMigracion` exige que **TODOS** los renglones vivos lleven la marca del ETL, no
     * que la lleve alguno. Si bastara uno, una orden que alguien ya curó —le agregó un avío a mano,
     * le volvió a firmar un renglón— seguiría apartada del grupo para siempre. Aquí la 3 es
     * histórica pero alguien la tocó, así que vuelve a la comparación y hace grupo con la 4.
     */
    const r = compararConHermanas([
      historica(1, comoEstabaEnElEtl()),
      historica(2, comoEstabaEnElEtl()),
      op(3, comoEstabaEnElEtl()),
      op(4, conElAvioNuevo()),
    ]);
    expect(r.get(3)?.hermanas).toBe(1);
    expect(r.get(4)?.hermanas).toBe(1);
    // Empate 1-1 entre las dos que sí votan ⇒ las dos avisan.
    expect(r.get(3)?.aviso).not.toBeNull();
    expect(r.get(4)?.aviso).not.toBeNull();
  });

  it('⚠️⚠️ EL COSTE: sobre una familia migrada, el caso del CIERRE CAFÉ se queda MUDO', () => {
    /*
     * 🔴 **Esta prueba fija un LÍMITE, no una victoria.** Es literalmente el caso de Daniel —«no
     * hubo cierre de ese tono y se compró otro sólo para la café»— sobre una familia nacida en
     * Access, que es toda la que estará viva el día del arranque: las tres hermanas migradas no
     * votan, la café se queda sin grupo y **el aviso no habla**. La comparación VERTICAL tampoco
     * dice nada, porque `desviadoAProposito` calla los renglones `agregadoAMano`.
     *
     * Se acepta porque la alternativa —dejar votar al histórico— **invierte** el aviso y señala a
     * la OP correcta, y de ese ruido no se vuelve. Y porque **no es permanente**: la prueba de
     * abajo fija que basta con que una persona firme la receta de UNA hermana.
     *
     * ⚠️ Si algún día esto se pone rojo, no es una regresión: es que alguien cambió la decisión.
     */
    const r = compararConHermanas([
      historica(1, comoEstabaEnElEtl()),
      historica(2, comoEstabaEnElEtl()),
      historica(3, comoEstabaEnElEtl()),
      // La café: le agregaron a mano el cierre que no había de ese tono.
      op(4, [...comoEstabaEnElEtl(), avio(99, 1, { nombre: 'CIE-02 — Cierre café' })]),
    ]);
    expect(r.get(4)?.aviso).toBeNull();
    expect(r.get(4)?.hermanas).toBe(0);
    // Lo único que se dice es que la familia quedó fuera — y sólo el BANNER de la receta lo enseña.
    expect(r.get(4)?.notaFueraDeLaComparacion).toContain('3 OP del modelo quedaron fuera');
  });

  it('⭐⭐ LA MITIGACIÓN: basta que UNA hermana tenga receta firmada por una persona', () => {
    // El mismo caso de arriba, con la 3 ya trabajada en v2 (firmada por una persona ⇒ sin marca).
    // Con eso hay grupo y el aviso del cierre café vuelve a hablar.
    const r = compararConHermanas([
      historica(1, comoEstabaEnElEtl()),
      historica(2, comoEstabaEnElEtl()),
      op(3, comoEstabaEnElEtl()),
      op(4, [...comoEstabaEnElEtl(), avio(99, 1, { nombre: 'CIE-02 — Cierre café' })]),
    ]);
    expect(r.get(4)?.aviso).toContain('CIE-02 — Cierre café');
    expect(r.get(4)?.hermanas).toBe(1);
    expect(r.get(4)?.diferencias[0]).toMatchObject({ que: 'solo-esta', tipo: 'avio' });
  });

  it('⭐⭐ EL CUADRANTE QUE FALTABA: la JARETA sobre una familia de BACKFILL sí habla', () => {
    /*
     * 🔴 Éste era estrictamente PEOR que el cierre café y estaba sin prueba: `quitarRenglonReceta`
     * no revoca la firma, así que los renglones vivos seguían siendo todos del backfill y **la
     * propia OP quedaba fuera de la comparación** — ni siquiera se comparaba. Con la lápida
     * `ajustado` contando como decisión, la OP vuelve al grupo.
     *
     * ⚠️ Aquí sólo la 4 tiene lápida, así que es la única que vuelve: se queda sin hermanas y no
     * habla (el coste ya declarado). Lo que esta prueba fija es que **entra**, que es lo que antes
     * no pasaba — y la de abajo, que con una hermana trabajada el aviso sale.
     */
    const r = compararConHermanas([
      historica(1, comoEstabaEnElEtl()),
      historica(2, comoEstabaEnElEtl()),
      historica(3, comoEstabaEnElEtl()),
      // La 4 le quitó la jareta: lleva la tela, ya no el botón.
      historicaConJareta(4, [tela(7, 1.5)]),
    ]);
    expect(r.get(4)?.fueraDeLaComparacion).toBe(3);
    // 🔴 Lo que fallaba: la 4 se contaba a sí misma entre las apartadas (`fuera` habría sido 4).
    expect(r.get(1)?.fueraDeLaComparacion).toBe(2);
  });

  it('⭐⭐ JARETA × BACKFILL con una hermana trabajada: el aviso SÍ habla', () => {
    const r = compararConHermanas([
      historica(1, comoEstabaEnElEtl()),
      historica(2, comoEstabaEnElEtl()),
      // La 3 la firmó una persona (sin marca); la 4 le quitó la jareta.
      op(3, comoEstabaEnElEtl()),
      historicaConJareta(4, [tela(7, 1.5)]),
    ]);
    expect(r.get(4)?.hermanas).toBe(1);
    expect(r.get(4)?.diferencias[0]).toMatchObject({ que: 'no-la-lleva', tipo: 'avio' });
    expect(r.get(4)?.aviso).not.toBeNull();
  });

  it('🔴 LA PRUEBA DE LA PRUEBA: apartada vs. dentro sólo se distinguen por `aviso`/`diferencias`', () => {
    /*
     * Esta prueba no fija una conducta nueva: fija **que las aserciones de las otras midan algo**.
     * Medido con sonda, comparando los dos mundos (`escritaPorLaMigracion` true/false) sobre el
     * MISMO montaje:
     *  • `fueraDeLaComparacion` → 0 en los dos  ❌
     *  • `hermanas`             → 1 en los dos  ❌  (cuenta las comparables del grupo, y la
     *                                                trabajada está ahí de las dos maneras)
     *  • `aviso` / `diferencias` → no / sí       ✅
     *
     * Por eso las pruebas de «marcar revisado» y «reabrir» (int) aseveran sobre `aviso`, y NO sobre
     * las dos primeras: con ellas habrían seguido verdes aunque la conducta cambiara.
     */
    const trabajada = op(3, [...comoEstabaEnElEtl(), avio(99, 1, { nombre: 'CIE-02' })]);
    const apartada = compararConHermanas([historica(1, comoEstabaEnElEtl()), trabajada]);
    const dentro = compararConHermanas([op(1, comoEstabaEnElEtl()), trabajada]);

    // Las dos cantidades que NO distinguen (si alguna vez lo hicieran, esto lo dice).
    expect(apartada.get(1)?.fueraDeLaComparacion).toBe(dentro.get(1)?.fueraDeLaComparacion);
    expect(apartada.get(1)?.hermanas).toBe(dentro.get(1)?.hermanas);
    // Las que SÍ.
    expect(apartada.get(1)?.aviso).toBeNull();
    expect(dentro.get(1)?.aviso).not.toBeNull();
    expect(apartada.get(1)?.diferencias).toEqual([]);
    expect(dentro.get(1)?.diferencias.length).toBeGreaterThan(0);
  });

  it('dos OP NUEVAS del mismo modelo se comparan aunque el resto sea histórico', () => {
    const r = compararConHermanas([
      historica(1, comoEstabaEnElEtl()),
      historica(2, comoEstabaEnElEtl()),
      op(3, conElAvioNuevo()),
      op(4, comoEstabaEnElEtl()),
    ]);
    // Empate 1-1 entre las dos nuevas ⇒ no hay norma y las dos avisan.
    expect(r.get(3)?.aviso).not.toBeNull();
    expect(r.get(4)?.aviso).not.toBeNull();
    expect(r.get(3)?.hermanas).toBe(1);
    expect(r.get(3)?.fueraDeLaComparacion).toBe(2);
    // Y las históricas ni avisan ni reciben aviso.
    expect(r.get(1)?.aviso).toBeNull();
    expect(r.get(1)?.fueraDeLaComparacion).toBe(1);
  });
});

// ── 🔴 D2: la intersección de tallas no puede apagar la comparación ───────────────────────

describe('las medidas por talla — el corte común no puede apagar el guardián', () => {
  const porTalla = (medidas: [number, number][]): MaterialDeLaOp =>
    avio(30, 1, { porTalla: true, medidas });

  it('A y B por talla con medidas distintas se señalan (control)', () => {
    const r = compararConHermanas([
      op(1, [
        porTalla([
          [1, 1],
          [2, 2],
        ]),
      ]),
      op(2, [
        porTalla([
          [1, 1],
          [2, 9],
        ]),
      ]),
    ]);
    expect(r.get(1)?.aviso).not.toBeNull();
    expect(r.get(2)?.aviso).not.toBeNull();
  });

  it('🔴 una hermana que captura POR PRENDA no apaga las medidas de las otras dos', () => {
    // Su mapa está vacío CON TODA RAZÓN. Metiéndola en la intersección, el corte se vacía y A y B
    // dejaban de avisar: un guardián apagándose solo.
    const r = compararConHermanas([
      op(1, [
        porTalla([
          [1, 1],
          [2, 2],
        ]),
      ]),
      op(2, [
        porTalla([
          [1, 1],
          [2, 9],
        ]),
      ]),
      op(3, [avio(30, 1, { porTalla: false })]),
    ]);
    expect(r.get(1)?.aviso).not.toBeNull();
    expect(r.get(2)?.aviso).not.toBeNull();
    // Y la de por prenda difiere de las dos por el MODO de captura.
    expect(r.get(3)?.aviso).not.toBeNull();
  });

  it('🔴 una curva DISJUNTA no apaga a nadie: sin corte común se comparan los mapas enteros', () => {
    const r = compararConHermanas([
      op(1, [
        porTalla([
          [1, 1],
          [2, 2],
        ]),
      ]),
      op(2, [
        porTalla([
          [1, 1],
          [2, 9],
        ]),
      ]),
      op(3, [porTalla([[7, 5]])]),
    ]);
    // Las tres tienen mapas distintos ⇒ tres valores ⇒ empate en el máximo ⇒ avisan las tres.
    for (const id of [1, 2, 3]) expect(r.get(id)?.aviso).not.toBeNull();
  });

  it('🔴 CONTROL NEGATIVO: dos por talla con el MISMO mapa siguen sin avisar', () => {
    const r = compararConHermanas([
      op(1, [
        porTalla([
          [1, 1],
          [2, 2],
        ]),
      ]),
      op(2, [
        porTalla([
          [1, 1],
          [2, 2],
        ]),
      ]),
      op(3, [avio(30, 1, { porTalla: false })]),
    ]);
    expect(r.get(1)?.aviso).toBeNull();
    expect(r.get(2)?.aviso).toBeNull();
  });

  it('🔴 con curvas SOLAPADAS, una hermana por prenda no debe volcar la comparación al mapa entero', () => {
    /*
     * El caso que distingue la regla de su versión rota, y no es el mismo que el de arriba: dos OP
     * por talla que **coinciden en el corte común** ({1}) pero difieren FUERA de él. Metiendo a la
     * de por prenda en la intersección, el corte se vacía, se cae al mapa entero y las dos pasan a
     * diferir ⇒ empate a tres y **avisan las tres**. Con la regla buena son mayoría y sólo se
     * señala a la de por prenda, que es la que de verdad captura distinto.
     */
    const r = compararConHermanas([
      op(1, [
        porTalla([
          [1, 1],
          [2, 2],
        ]),
      ]),
      op(2, [
        porTalla([
          [1, 1],
          [3, 9],
        ]),
      ]),
      op(3, [avio(30, 1, { porTalla: false })]),
    ]);
    expect(r.get(1)?.aviso).toBeNull();
    expect(r.get(2)?.aviso).toBeNull();
    expect(r.get(3)?.aviso).not.toBeNull();
  });

  it('🔴 CONTROL NEGATIVO: curvas SOLAPADAS que coinciden en lo común no avisan', () => {
    // Aquí sí manda el corte común ({1}): la talla que sólo una pide es del PEDIDO, no de la receta.
    const r = compararConHermanas([
      op(1, [
        porTalla([
          [1, 1],
          [2, 2],
        ]),
      ]),
      op(2, [
        porTalla([
          [1, 1],
          [3, 9],
        ]),
      ]),
    ]);
    expect(r.get(1)?.aviso).toBeNull();
    expect(r.get(2)?.aviso).toBeNull();
  });
});

// ── D4: con cuántas difiere, no cuántas tiene ─────────────────────────────────────────────

describe('el resumen dice con CUÁNTAS hermanas difiere', () => {
  it('🔴 con 3-2, a la minoritaria se le dice 3 (no «sus 4 hermanas»): coincide con una', () => {
    const r = compararConHermanas([
      op(1, [tela(7, 1)]),
      op(2, [tela(7, 1)]),
      op(3, [tela(7, 1)]),
      op(4, [tela(7, 2)]),
      op(5, [tela(7, 2)]),
    ]);
    expect(r.get(4)?.hermanas).toBe(4);
    expect(r.get(4)?.aviso).toContain('no va igual que 3 de sus 4 hermanas');
    expect(r.get(4)?.aviso).not.toContain('no va igual que sus 4 hermanas');
    // La mayoritaria no recibe nada.
    expect(r.get(1)?.aviso).toBeNull();
  });

  it('cuando difiere de TODAS, la frase se queda corta', () => {
    const r = compararConHermanas([op(1, [tela(7, 1)]), op(2, [tela(7, 1)]), op(3, [tela(7, 2)])]);
    expect(r.get(3)?.aviso).toContain('no va igual que sus 2 hermanas');
  });
});

// ── D3: la nota de las apartadas, redactada por el servidor ───────────────────────────────

describe('la nota de las OP que quedaron fuera', () => {
  it('la redacta el SERVIDOR, en singular', () => {
    const r = compararConHermanas([
      op(1, [tela(7, 1)]),
      op(2, [tela(7, 1)]),
      op(3, [], { tieneReceta: false }),
    ]);
    expect(r.get(1)?.fueraDeLaComparacion).toBe(1);
    expect(r.get(1)?.notaFueraDeLaComparacion).toBe(
      '1 OP del modelo quedó fuera de la comparación (es histórico migrado, o no tiene receta capturada).',
    );
  });

  it('🔴 se redacta AUNQUE no haya ninguna diferencia (es el caso silencioso)', () => {
    const r = compararConHermanas([
      op(1, [tela(7, 1)]),
      op(2, [tela(7, 1)]),
      historica(3, [tela(7, 9)]),
      historica(4, [tela(7, 9)]),
    ]);
    expect(r.get(1)?.aviso).toBeNull();
    expect(r.get(1)?.notaFueraDeLaComparacion).toContain('2 OP del modelo quedaron fuera');
  });

  it('🔴 CONTROL NEGATIVO: sin ninguna apartada, la nota es null', () => {
    const r = compararConHermanas([op(1, [tela(7, 1)]), op(2, [tela(7, 1)])]);
    expect(r.get(1)?.fueraDeLaComparacion).toBe(0);
    expect(r.get(1)?.notaFueraDeLaComparacion).toBeNull();
  });
});
