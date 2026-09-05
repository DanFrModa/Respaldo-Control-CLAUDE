import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  evaluarRiesgoDeTono,
  evaluarSobreSalidaDeTela,
  previaSalidaTelaColorAOrden,
  type LineaCapturada,
  type RequeridoDeTela,
} from './previa-salida-tela-orden.js';
import type { PreviaSalidaPartida } from '../../contrato/index.js';

/**
 * Unit de LOS DOS AVISOS de la salida de tela (fila 0.101 — Daniel §Post-F9.193, dec. 8 y 9), SIN
 * Postgres: aquí vive la aritmética y el veredicto de cada aviso.
 *
 *  • (a) **sobre-salida**: lo capturado + LO YA SACADO ANTES contra lo que la orden pide.
 *  • (b) **riesgo de tono**: sólo con MÁS DE UNA partida del color, y con la lista a la vista.
 *
 * Lo que necesita base de datos —de dónde sale el requerido (`RequerimientoOrden`, la cifra del
 * comprador), qué salidas cuentan como «ya salido» y qué partidas están vivas en el almacén— se
 * prueba contra Postgres en `previa-salida-tela-orden.int.test.ts`.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

const FELPA = { idTela: 1, tela: 'Felpa Suiza' };
const LISA = { idTela: 2, tela: 'Lisa Algodón' };

/** Un renglón de la pantalla LEGADA por lote: tela SIN color. */
function lineaSinColor(tela: { idTela: number; tela: string }, cantidad: number): LineaCapturada {
  return { idTelaColor: null, telaColor: null, idTela: tela.idTela, tela: tela.tela, cantidad };
}

/** Un renglón capturado (lo que se está a punto de sacar). */
function linea(
  idTelaColor: number,
  telaColor: string,
  tela: { idTela: number; tela: string },
  cantidad: number,
): LineaCapturada {
  return { idTelaColor, telaColor, idTela: tela.idTela, tela: tela.tela, cantidad };
}

/** El requerido del snapshot de la explosión, indexado por tela. */
function requeridos(...filas: RequeridoDeTela[]): Map<number, RequeridoDeTela> {
  return new Map(filas.map((f) => [f.idTela, f]));
}

/** Lo que YA salió antes contra la orden, por tela. */
function yaSalido(...pares: [number, number][]): Map<number, number> {
  return new Map(pares);
}

/** Una partida conocida del color en el almacén (100 unidades entradas, salvo que se diga otra). */
function partida(
  id: number,
  folio: number,
  lote: string | null,
  entrado = 100,
): PreviaSalidaPartida {
  return { id, folio, loteProveedor: lote, factura: null, fecha: null, entrado };
}

/** Existencia (cuerpo + complemento) de cada color EN ESE ALMACÉN. */
function existencias(...pares: [number, number][]): Map<number, number> {
  return new Map(pares);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// (a) SOBRE-SALIDA — «sacas más de lo que la orden pide»
// ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('aviso (a) — sobre-salida contra lo que la orden pide', () => {
  it('NO avisa cuando lo que se saca cabe en lo que la orden pide', () => {
    const [tela] = evaluarSobreSalidaDeTela(
      [linea(11, 'Marino', FELPA, 800)],
      requeridos({ idTela: 1, unidad: 'KG', requerido: 1000 }),
      yaSalido(),
    );
    expect(tela).toMatchObject({ requerido: 1000, yaSalido: 0, aSacar: 800 });
    expect(tela?.excedente).toBe(0);
    expect(tela?.sobreSalida).toBe(false);
  });

  it('AVISA cuando el renglón capturado ya se pasa, y dice POR CUÁNTO', () => {
    const [tela] = evaluarSobreSalidaDeTela(
      [linea(11, 'Marino', FELPA, 1200)],
      requeridos({ idTela: 1, unidad: 'KG', requerido: 1000 }),
      yaSalido(),
    );
    expect(tela?.sobreSalida).toBe(true);
    expect(tela?.excedente).toBe(200);
    // El aviso trae el número del comprador (1000) para poder enseñarlo tal cual.
    expect(tela?.requerido).toBe(1000);
    expect(tela?.unidad).toBe('KG');
  });

  // 🔴 EL CASO QUE EVADE AL AVISO INGENUO: ninguna de las dos tandas se pasa por sí sola.
  // Si `yaSalido` no contara, 400 contra 1000 diría "cabe" y sacar de a poquito burlaría el aviso.
  it('AVISA cuando son DOS TANDAS que SUMADAS se pasan (aunque ninguna se pase sola)', () => {
    const [tela] = evaluarSobreSalidaDeTela(
      [linea(11, 'Marino', FELPA, 400)],
      requeridos({ idTela: 1, unidad: 'KG', requerido: 1000 }),
      yaSalido([1, 700]), // la tanda anterior
    );
    expect(tela?.yaSalido).toBe(700);
    expect(tela?.aSacar).toBe(400);
    expect(tela?.excedente).toBe(100);
    expect(tela?.sobreSalida).toBe(true);
  });

  it('suma los COLORES de la misma tela: la comparación es por TELA', () => {
    const [tela] = evaluarSobreSalidaDeTela(
      [linea(11, 'Marino', FELPA, 200), linea(12, 'Rojo', FELPA, 900)],
      requeridos({ idTela: 1, unidad: 'KG', requerido: 1000 }),
      yaSalido(),
    );
    expect(tela?.aSacar).toBe(1100);
    expect(tela?.excedente).toBe(100);
    expect(tela?.sobreSalida).toBe(true);
    expect(tela?.colores).toEqual(['Marino', 'Rojo']);
  });

  it('cada tela se compara contra LA SUYA (una se pasa, la otra no)', () => {
    const telas = evaluarSobreSalidaDeTela(
      [linea(11, 'Marino', FELPA, 1200), linea(21, 'Negro', LISA, 50)],
      requeridos(
        { idTela: 1, unidad: 'KG', requerido: 1000 },
        { idTela: 2, unidad: 'M', requerido: 300 },
      ),
      yaSalido(),
    );
    expect(telas.map((t) => [t.tela, t.sobreSalida])).toEqual([
      ['Felpa Suiza', true],
      ['Lisa Algodón', false],
    ]);
  });

  // Callar cuando NO se sabe: sin explosión no hay contra qué comparar, y un requerido inventado
  // en cero convertiría cada salida de una orden sin explotar en un falso positivo.
  it('CALLA cuando la explosión no dice nada de esa tela (requerido null)', () => {
    const [tela] = evaluarSobreSalidaDeTela(
      [linea(11, 'Marino', FELPA, 5000)],
      requeridos(),
      yaSalido(),
    );
    expect(tela?.requerido).toBeNull();
    expect(tela?.excedente).toBe(0);
    expect(tela?.sobreSalida).toBe(false);
  });

  // La pantalla LEGADA por lote saca tela sin color. Si no contara, sería la puerta trasera por la
  // que se saca de más sin que nadie diga nada.
  it('cuenta también los renglones SIN COLOR (captura legada por lote)', () => {
    const [tela] = evaluarSobreSalidaDeTela(
      [linea(11, 'Marino', FELPA, 600), lineaSinColor(FELPA, 600)],
      requeridos({ idTela: 1, unidad: 'KG', requerido: 1000 }),
      yaSalido(),
    );
    expect(tela?.aSacar).toBe(1200);
    expect(tela?.excedente).toBe(200);
    expect(tela?.sobreSalida).toBe(true);
    // El color sólo se nombra cuando lo hay: el renglón legado no inventa uno.
    expect(tela?.colores).toEqual(['Marino']);
  });

  // 🔴 EL RUIDO DE COMA FLOTANTE, y qué lo filtra DE VERDAD. `400.1 + 200.3 − 600.4` no da 0 en
  // binario: da 1.1368683772161603e-13, POSITIVO. Lo que lo mata es el redondeo a los 4 decimales
  // de la columna (`Decimal(14,4)`), no ninguna tolerancia — la que había (`> 1e-6` sobre un número
  // YA redondeado) era inerte, y esta prueba pasaba por una razón distinta de la que decía vigilar.
  // Rómpele el redondeo a `aCantidad` y esta prueba se pone roja; ésa es su vigilancia real.
  it('no grita por el ruido decimal: 400.1 ya salidos + 200.3 que se sacan contra 600.4', () => {
    expect(400.1 + 200.3 - 600.4).toBeGreaterThan(0); // el ruido existe y es POSITIVO
    const [tela] = evaluarSobreSalidaDeTela(
      [linea(11, 'Marino', FELPA, 200.3)],
      requeridos({ idTela: 1, unidad: 'KG', requerido: 600.4 }),
      yaSalido([1, 400.1]),
    );
    expect(tela?.excedente).toBe(0);
    expect(tela?.sobreSalida).toBe(false);
  });

  // Y el otro lado de la misma moneda: el exceso más chico que la base puede guardar SÍ avisa.
  it('un exceso de 0.0001 (lo más fino que guarda la columna) SÍ avisa', () => {
    const [tela] = evaluarSobreSalidaDeTela(
      [linea(11, 'Marino', FELPA, 1000.0001)],
      requeridos({ idTela: 1, unidad: 'KG', requerido: 1000 }),
      yaSalido(),
    );
    expect(tela?.excedente).toBe(0.0001);
    expect(tela?.sobreSalida).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// (b) RIESGO DE TONO — sólo con MÁS DE UNA partida del color
// ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('aviso (b) — riesgo de tono: TRES estados, no dos', () => {
  // 🔴 La conducta que la 0.101 vino a arreglar: hasta la 0.100 este aviso salía SIEMPRE.
  it('UNA sola partida que explica toda la existencia = SIN RIESGO: el aviso se calla', () => {
    const [color] = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100)],
      new Map([[11, [partida(1, 501, 'L-A', 500)]]]),
      existencias([11, 500]),
    );
    expect(color?.estadoTono).toBe('sin-riesgo');
    expect(color?.partidas).toHaveLength(1);
  });

  it('con DOS partidas avisa, y las LISTA para poder escoger', () => {
    const [color] = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100)],
      new Map([[11, [partida(1, 501, 'L-A', 500), partida(2, 502, 'L-B', 300)]]]),
      existencias([11, 800]),
    );
    expect(color?.estadoTono).toBe('varias-partidas');
    expect(color?.partidas.map((p) => p.folio)).toEqual([501, 502]);
    expect(color?.partidas.map((p) => p.loteProveedor)).toEqual(['L-A', 'L-B']);
  });

  // ⭐⭐ EL TERCER ESTADO — el hueco que el revisor midió: la tela que llega por TRASPASO entra SIN
  // partida, así que contar partidas dejaba el aviso mudo en el almacén del cortador (que es
  // adonde llega traspasada) con N tonos enfrente de quien escoge el rollo.
  it('HAY TELA pero NINGUNA partida conocida (llegó traspasada) = ORIGEN DESCONOCIDO: avisa', () => {
    const [color] = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100)],
      new Map(),
      existencias([11, 800]),
    );
    expect(color?.estadoTono).toBe('origen-desconocido');
    expect(color?.existencia).toBe(800);
    expect(color?.entradoConocido).toBe(0);
    expect(color?.sinNombrar).toBe(800);
    expect(color?.partidas).toEqual([]);
  });

  // El caso MIXTO, que la regla de "cero partidas" seguiría callando por la misma razón: una
  // partida conocida de 500 y 300 más que llegaron traspasados.
  it('UNA partida conocida que NO explica toda la existencia también avisa', () => {
    const [color] = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100)],
      new Map([[11, [partida(1, 501, 'L-A', 500)]]]),
      existencias([11, 800]),
    );
    expect(color?.estadoTono).toBe('origen-desconocido');
    expect(color?.existencia).toBe(800);
    expect(color?.entradoConocido).toBe(500);
    expect(color?.sinNombrar).toBe(300);
  });

  // ⭐⭐ LAS DOS CONDICIONES A LA VEZ — y quién gana NO puede quedar al azar del orden en que
  // alguien escriba el ternario. Gana la ALARMA, porque es la que trae información accionable (la
  // lista de entre las que escoger); invertirlo escondería esa lista justo en el caso mixto.
  it('con VARIAS partidas Y tela sin nombrar gana la ALARMA (y dice cuánto no puede nombrar)', () => {
    const [color] = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100)],
      new Map([[11, [partida(1, 501, 'L-A', 500), partida(2, 502, 'L-B', 300)]]]),
      existencias([11, 1000]), // 800 de las dos partidas + 200 que llegaron traspasados
    );
    expect(color?.estadoTono).toBe('varias-partidas');
    expect(color?.entradoConocido).toBe(800);
    expect(color?.sinNombrar).toBe(200);
    // La lista sigue viajando: es lo que hace accionable a la alarma.
    expect(color?.partidas).toHaveLength(2);
  });

  it('`sinNombrar` es 0 cuando las partidas conocidas explican todo (no hay coletilla que poner)', () => {
    const [color] = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100)],
      new Map([[11, [partida(1, 501, 'L-A', 500), partida(2, 502, 'L-B', 300)]]]),
      existencias([11, 800]),
    );
    expect(color?.estadoTono).toBe('varias-partidas');
    expect(color?.sinNombrar).toBe(0);
  });

  it('una partida ya consumida (existencia por debajo de lo entrado) NO dispara nada', () => {
    const [color] = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100)],
      new Map([[11, [partida(1, 501, 'L-A', 500)]]]),
      existencias([11, 120]),
    );
    expect(color?.estadoTono).toBe('sin-riesgo');
    // Y no se va a negativo: 120 − 500 no es «−380 sin nombrar», es «nada sin nombrar».
    expect(color?.sinNombrar).toBe(0);
  });

  it('sin tela ninguna de ese color en ese almacén tampoco hay nada que decir', () => {
    const [color] = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100)],
      new Map(),
      existencias(),
    );
    expect(color?.estadoTono).toBe('sin-riesgo');
    expect(color?.existencia).toBe(0);
  });

  it('el ruido decimal no inventa tela de origen desconocido', () => {
    // 400.1 + 200.3 entradas conocidas contra 600.4 de existencia: en binario la Σ da 600.4000…04.
    const [color] = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 10)],
      new Map([[11, [partida(1, 501, 'L-A', 400.1), partida(2, 502, 'L-B', 200.3)]]]),
      existencias([11, 600.4]),
    );
    expect(color?.entradoConocido).toBe(600.4);
    // (con DOS partidas el estado ya es `varias-partidas`; lo que se mide aquí es la aritmética)
    expect(color?.existencia).toBe(600.4);
  });

  it('el riesgo es POR COLOR: uno avisa y el otro no, en la misma captura', () => {
    const colores = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100), linea(21, 'Negro', LISA, 50)],
      new Map([
        [11, [partida(1, 501, 'L-A', 500), partida(2, 502, 'L-B', 300)]],
        [21, [partida(3, 503, null, 400)]],
      ]),
      existencias([11, 800], [21, 400]),
    );
    expect(colores.map((c) => [c.telaColor, c.estadoTono])).toEqual([
      ['Marino', 'varias-partidas'],
      ['Negro', 'sin-riesgo'],
    ]);
  });

  it('los renglones SIN COLOR (legado por lote) no participan del riesgo de tono', () => {
    const colores = evaluarRiesgoDeTono(
      [lineaSinColor(FELPA, 100)],
      new Map([[11, [partida(1, 501, 'L-A'), partida(2, 502, 'L-B')]]]),
      existencias([11, 800]),
    );
    expect(colores).toEqual([]);
  });

  it('un color repetido en la captura no duplica su renglón de aviso', () => {
    const colores = evaluarRiesgoDeTono(
      [linea(11, 'Marino', FELPA, 100), linea(11, 'Marino', FELPA, 50)],
      new Map([[11, [partida(1, 501, 'L-A'), partida(2, 502, 'L-B')]]]),
      existencias([11, 800]),
    );
    expect(colores).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Guard de permiso (A4, deny-by-default)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('guard de permiso de la previa', () => {
  it('rechaza pedir los avisos sin inventario-telas.mover', async () => {
    await expect(
      previaSalidaTelaColorAOrden(sesionDePrueba({ permisos: [] }), {
        idOrden: 1,
        idAlmacen: 1,
        lineas: [{ idTelaColor: 11, cantidad: 10 }],
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
