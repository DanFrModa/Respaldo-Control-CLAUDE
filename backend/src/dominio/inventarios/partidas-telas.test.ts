import { describe, expect, it } from 'vitest';

import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  calcularDeltasConteo,
  idsDeColorPedidos,
  registrarConteoTelaColor,
  saldosTelaColorParaConteo,
  type ColorConTela,
  type LineaConteoBase,
  type SaldoConteo,
} from './partidas-telas.js';

/**
 * Unit del CONTEO FÍSICO de tela por COLOR (fila 0.098) — SIN Postgres. La pantalla «Ajuste de
 * telas por color» —la que va a INICIALIZAR el inventario el día del arranque— no tenía NI UNA
 * prueba: ésta es su primera red.
 *
 * Cubre lo PURO: la aritmética `contado − teórico` y su reparto en las dos patas
 * ({@link calcularDeltasConteo}) y los guards de permiso (A4, deny-by-default). Lo transaccional
 * (lock por color, saldo por Σ directa nunca la vista, partidas de la pata de entrada, no-negativo
 * por construcción) se prueba contra Postgres en `partidas-telas.int.test.ts` (CI).
 */

// ── Fixtures del catálogo (una tela CON complemento y una SIN) ───────────────────────────────────
const FELPA: ColorConTela = {
  idTelaColor: 11,
  nombreColor: 'Marino',
  idTela: 1,
  nombreTela: 'Felpa Suiza',
  nombreComplemento: 'Cardigan',
};
const LISA: ColorConTela = {
  idTelaColor: 21,
  nombreColor: 'Negro',
  idTela: 2,
  nombreTela: 'Lisa Algodón',
  nombreComplemento: null,
};
const colores = new Map<number, ColorConTela>([
  [FELPA.idTelaColor, FELPA],
  [LISA.idTelaColor, LISA],
]);

/** Atajo: los saldos del sistema por color. */
function saldos(entradas: [number, SaldoConteo][]): Map<number, SaldoConteo> {
  return new Map(entradas);
}

/** Atajo: un renglón contado. */
function contado(
  idTelaColor: number,
  contadoCuerpo: number,
  contadoComplemento?: number,
): LineaConteoBase {
  return {
    idTelaColor,
    contadoCuerpo,
    ...(contadoComplemento === undefined ? {} : { contadoComplemento }),
  };
}

describe('conteo de tela por color — aritmética pura (contado − teórico)', () => {
  it('FALTANTE (contado > sistema) → pata de ENTRADA por la diferencia, no por lo contado', () => {
    const d = calcularDeltasConteo(
      [contado(11, 130, 50)],
      saldos([[11, { cuerpo: 100, complemento: 40 }]]),
      colores,
    );
    expect(d.salidas).toHaveLength(0);
    // 130 contados con 100 en el sistema = entra 30 (no 130: eso sería capturar lo contado como
    // si fuera un ajuste de entrada, que es justo el defecto que esto arregla).
    expect(d.entradas).toEqual([{ idTelaColor: 11, cantidad: 30, cantidadComplemento: 10 }]);
    expect(d.indicesEntradas).toEqual([0]);
    expect(d.renglones[0]).toMatchObject({
      teoricoCuerpo: 100,
      contadoCuerpo: 130,
      diferenciaCuerpo: 30,
      teoricoComplemento: 40,
      contadoComplemento: 50,
      diferenciaComplemento: 10,
    });
  });

  it('SOBRANTE (contado < sistema) → pata de SALIDA por la diferencia, en POSITIVO', () => {
    const d = calcularDeltasConteo(
      [contado(11, 80, 25)],
      saldos([[11, { cuerpo: 100, complemento: 40 }]]),
      colores,
    );
    expect(d.entradas).toHaveLength(0);
    // El signo lo pone la dirección del movimiento: la cantidad viaja positiva.
    expect(d.salidas).toEqual([{ idTelaColor: 11, cantidad: 20, cantidadComplemento: 15 }]);
    expect(d.renglones[0]).toMatchObject({ diferenciaCuerpo: -20, diferenciaComplemento: -15 });
  });

  it('ARRANQUE desde cero: con el sistema en 0, la diferencia ES lo contado', () => {
    const d = calcularDeltasConteo(
      [contado(11, 250, 60)],
      saldos([[11, { cuerpo: 0, complemento: 0 }]]),
      colores,
    );
    expect(d.entradas).toEqual([{ idTelaColor: 11, cantidad: 250, cantidadComplemento: 60 }]);
    expect(d.salidas).toHaveLength(0);
  });

  it('CUADRA en todo → ninguna pata (un conteo exacto no escribe movimiento)', () => {
    const d = calcularDeltasConteo(
      [contado(11, 100, 40), contado(21, 33)],
      saldos([
        [11, { cuerpo: 100, complemento: 40 }],
        [21, { cuerpo: 33, complemento: 0 }],
      ]),
      colores,
    );
    expect(d.entradas).toHaveLength(0);
    expect(d.salidas).toHaveLength(0);
    // …pero el detalle sí se devuelve, para que el usuario vea que cuadró.
    expect(d.renglones).toHaveLength(2);
    expect(d.renglones.every((r) => r.diferenciaCuerpo === 0)).toBe(true);
  });

  it('⭐ el MISMO color puede caer en las DOS patas: sobra cuerpo y falta complemento', () => {
    // Cada movimiento tiene UNA dirección, y cuerpo y complemento viajan en el mismo renglón: la
    // única forma de aplicar +complemento y −cuerpo del mismo color es partirlo en dos renglones.
    const d = calcularDeltasConteo(
      [contado(11, 90, 55)],
      saldos([[11, { cuerpo: 100, complemento: 40 }]]),
      colores,
    );
    expect(d.salidas).toEqual([{ idTelaColor: 11, cantidad: 10, cantidadComplemento: 0 }]);
    expect(d.entradas).toEqual([{ idTelaColor: 11, cantidad: 0, cantidadComplemento: 15 }]);
    expect(d.indicesEntradas).toEqual([0]);
  });

  // 🔴 EL ESPEJO DE LA DIAGONAL DE ARRIBA — la rama gemela que sobrevivió a la primera ronda.
  // El reviewer quitó el disyuntor `difComplemento < 0` de la pata de SALIDA y las 14 pruebas
  // seguían verdes: ningún caso tenía un complemento SOBRANTE sin un cuerpo sobrante que lo
  // tapara, así que la pata de salida siempre se abría por el cuerpo. Cada componente decide su
  // pata por separado; los cuatro cuadrantes tienen que estar escritos.
  it('⭐ ESPEJO: el cuerpo CUADRA y sobra complemento → SÓLO pata de salida, con cuerpo 0', () => {
    const d = calcularDeltasConteo(
      [contado(11, 100, 25)],
      saldos([[11, { cuerpo: 100, complemento: 40 }]]),
      colores,
    );
    expect(d.entradas).toEqual([]);
    // El cuerpo va en 0 porque cuadró: lo que sale es SÓLO el complemento.
    expect(d.salidas).toEqual([{ idTelaColor: 11, cantidad: 0, cantidadComplemento: 15 }]);
    expect(d.renglones[0]).toMatchObject({ diferenciaCuerpo: 0, diferenciaComplemento: -15 });
  });

  it('⭐ ESPEJO: FALTA cuerpo y SOBRA complemento → las dos patas, cruzadas al revés', () => {
    // La otra mitad de la diagonal cruzada: el caso ⭐ de arriba es (cuerpo−, complemento+); éste
    // es (cuerpo+, complemento−). Sin él, invertir el reparto entre patas pasaría desapercibido.
    const d = calcularDeltasConteo(
      [contado(11, 130, 25)],
      saldos([[11, { cuerpo: 100, complemento: 40 }]]),
      colores,
    );
    expect(d.entradas).toEqual([{ idTelaColor: 11, cantidad: 30, cantidadComplemento: 0 }]);
    expect(d.salidas).toEqual([{ idTelaColor: 11, cantidad: 0, cantidadComplemento: 15 }]);
    expect(d.indicesEntradas).toEqual([0]);
  });

  it('⭐ ESPEJO: el cuerpo cuadra y FALTA complemento → sólo pata de entrada, con cuerpo 0', () => {
    // Completa la fila «cuerpo cuadra» de la tabla de cuadrantes: el gemelo de la primera de estas
    // tres, por la pata de ENTRADA.
    const d = calcularDeltasConteo(
      [contado(11, 100, 55)],
      saldos([[11, { cuerpo: 100, complemento: 40 }]]),
      colores,
    );
    expect(d.salidas).toEqual([]);
    expect(d.entradas).toEqual([{ idTelaColor: 11, cantidad: 0, cantidadComplemento: 15 }]);
  });

  it('tela SIN complemento: el complemento no entra en la cuenta ni aparece en el renglón', () => {
    const d = calcularDeltasConteo(
      [contado(21, 40)],
      saldos([[21, { cuerpo: 33, complemento: 0 }]]),
      colores,
    );
    // `cantidadComplemento` NO se manda (la columna distingue "no lleva" de "llevó 0").
    expect(d.entradas).toEqual([{ idTelaColor: 21, cantidad: 7 }]);
    expect(d.renglones[0]).toMatchObject({
      nombreComplemento: null,
      teoricoComplemento: 0,
      contadoComplemento: 0,
      diferenciaComplemento: 0,
    });
  });

  it('tela SIN complemento con saldo FANTASMA de complemento: se tolera, NO se compensa', () => {
    // REGLA 0-B: una fila vieja pudo dejar ahí un complemento. La pantalla no pide ese número, así
    // que bajarlo a 0 sería fabricar un movimiento que nadie contó.
    const d = calcularDeltasConteo(
      [contado(21, 33)],
      saldos([[21, { cuerpo: 33, complemento: 12 }]]),
      colores,
    );
    expect(d.entradas).toHaveLength(0);
    expect(d.salidas).toHaveLength(0);
    expect(d.renglones[0]?.diferenciaComplemento).toBe(0);
  });

  it('⭐ el ruido de la RESTA en coma flotante no se cuela al kardex', () => {
    // El saldo llega limpio (la Σ la hace Postgres con decimales exactos). El ruido nace AQUÍ, al
    // restar: 130.1 − 100.2 = 29.89999999999999, no 29.9. Sin redondear a la escala de la columna
    // —Decimal(14,4)— se aplicaría un movimiento con más decimales de los que la BD guarda.
    const d = calcularDeltasConteo(
      [contado(21, 130.1)],
      saldos([[21, { cuerpo: 100.2, complemento: 0 }]]),
      colores,
    );
    // Control: la resta cruda DE VERDAD trae ruido (si dejara de traerlo, esta prueba pasaría por
    // construcción y no probaría nada).
    expect(130.1 - 100.2).not.toBe(29.9);
    expect(d.entradas).toEqual([{ idTelaColor: 21, cantidad: 29.9 }]);
    expect(d.renglones[0]?.diferenciaCuerpo).toBe(29.9);
  });

  it('⭐ y un conteo que CUADRA con decimales no fabrica un movimiento fantasma', () => {
    // El caso peor del mismo defecto: si la resta dejara un residuo de 1e-15, el conteo "no
    // cuadraría" nunca y el kardex se llenaría de renglones de 0.0000.
    const teorico = 1.1 + 2.2; // 3.3000000000000003
    expect(teorico).not.toBe(3.3);
    const d = calcularDeltasConteo(
      [contado(21, 3.3)],
      saldos([[21, { cuerpo: teorico, complemento: 0 }]]),
      colores,
    );
    expect(d.entradas).toHaveLength(0);
    expect(d.salidas).toHaveLength(0);
    expect(d.renglones[0]?.diferenciaCuerpo).toBe(0);
  });

  it('una diferencia REAL de la escala de la columna (0.0001) sí se aplica', () => {
    // Control negativo del caso de arriba: el redondeo no se come una diferencia de verdad.
    const d = calcularDeltasConteo(
      [contado(21, 3.3001)],
      saldos([[21, { cuerpo: 3.3, complemento: 0 }]]),
      colores,
    );
    expect(d.entradas).toEqual([{ idTelaColor: 21, cantidad: 0.0001 }]);
  });

  it('varios renglones: cada uno contra SU saldo, y los índices amarran cada entrada a su línea', () => {
    const d = calcularDeltasConteo(
      [contado(21, 40), contado(11, 90, 40)],
      saldos([
        [21, { cuerpo: 33, complemento: 0 }],
        [11, { cuerpo: 100, complemento: 40 }],
      ]),
      colores,
    );
    expect(d.entradas).toEqual([{ idTelaColor: 21, cantidad: 7 }]);
    // La entrada es la línea 0 (la lisa), no la 1: el índice es el de `lineas`, no el de la pata.
    expect(d.indicesEntradas).toEqual([0]);
    expect(d.salidas).toEqual([{ idTelaColor: 11, cantidad: 10, cantidadComplemento: 0 }]);
  });

  it('un color sin saldo leído revienta (no se cuenta contra un teórico inventado)', () => {
    expect(() => calcularDeltasConteo([contado(11, 5)], saldos([]), colores)).toThrow(
      ErrorNoEncontrado,
    );
  });
});

describe('conteo de tela por color — permisos (A4, deny-by-default)', () => {
  const conteo = {
    idAlmacen: 1,
    fecha: '2026-09-02',
    motivo: 'conteo físico',
    lineas: [{ idTelaColor: 11, contadoCuerpo: 10 }],
  };

  it('rechaza registrar un conteo sin inventario-telas.mover', async () => {
    await expect(
      registrarConteoTelaColor(sesionDePrueba({ permisos: ['inventario-telas.ver'] }), conteo),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza consultar los saldos sin inventario-telas.ver', async () => {
    await expect(
      saldosTelaColorParaConteo(sesionDePrueba({ permisos: [] }), {
        idAlmacen: 1,
        idTelaColor: '11',
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EL GUARDIÁN DE LA INVARIANTE: la Σ sale de los MOVIMIENTOS, nunca de la vista (D3/ADR-0010 §3)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 Por qué esta prueba y no la de integración. Allá se comprobaba «el saldo refleja un traspaso
// sin refrescar ninguna vista» — y eso NO puede fallar: `existencia_tela_color` es un `CREATE VIEW`
// PLANO (migración 20260806130000_a2_partidas_telas), no materializado, así que se calcula al
// consultar y devolvería exactamente lo mismo. Pasaba por la razón equivocada, sobre la invariante
// más importante de la fila.
//
// El guardián de verdad mira el SQL que el código EMITE: con un `tx` espiado se captura cada
// consulta y se afirma (a) que la tabla leída es `movimiento_det_tela`, (b) que la vista NO aparece
// nunca, y (c) —el control que separa los dos mundos— que el camino de APLICAR sí toma el
// `pg_advisory_xact_lock` mientras que el de LEER la columna «Sistema» no.

/** Una consulta capturada del `tx` espiado: su SQL en texto plano. */
interface SqlCapturado {
  tipo: 'query' | 'execute';
  sql: string;
}

/** Aplana un `Prisma.Sql` (o un template tag) al texto que se manda a Postgres. */
function textoSql(entrada: unknown): string {
  if (typeof entrada === 'string') return entrada;
  if (Array.isArray(entrada)) return entrada.join(' ? ');
  const posible = entrada as { sql?: string; strings?: string[] };
  if (typeof posible.sql === 'string') return posible.sql;
  if (Array.isArray(posible.strings)) return posible.strings.join(' ? ');
  return JSON.stringify(entrada);
}

/** Colores que el espía devuelve en `telaColor.findMany` (los que la prueba diga). */
interface ColorEspia {
  id: number;
  nombre: string;
  tela: { id: number; nombre: string; nombreComplemento: string | null };
}

/**
 * `tx`/cliente mínimo que CAPTURA todo el SQL y devuelve lo justo para que el camino bajo prueba
 * llegue a su final sin BD. `filasSql` decide qué contesta cada `$queryRaw` (una Σ de un color, o
 * varias filas agrupadas).
 */
function clienteEspia(
  capturas: SqlCapturado[],
  filasSql: readonly Record<string, unknown>[],
  coloresEspia: readonly ColorEspia[],
): { tx: Tx; cliente: NonNullable<ContextoBd['cliente']> } {
  const doble = {
    $queryRaw: (entrada: unknown) => {
      capturas.push({ tipo: 'query', sql: textoSql(entrada) });
      return Promise.resolve([...filasSql]);
    },
    $executeRaw: (entrada: unknown) => {
      capturas.push({ tipo: 'execute', sql: textoSql(entrada) });
      return Promise.resolve(1);
    },
    telaColor: { findMany: () => Promise.resolve([...coloresEspia]) },
    // El almacén sale ACTIVO, GLOBAL y de TELA: el conteo pasa por `exigirAlmacenDelTipo`
    // (fila 0.137) antes de tocar nada, y este espía no está probando ese guard.
    almacen: {
      findUnique: () =>
        Promise.resolve({ nombre: 'Bodega A', activo: true, idEmpresa: null, tipo: 'TELA' }),
    },
  };
  return {
    tx: doble as unknown as Tx,
    cliente: doble as unknown as NonNullable<ContextoBd['cliente']>,
  };
}

/** El color de fixture del espía: felpa CON complemento. */
const COLOR_ESPIA: ColorEspia = {
  id: 11,
  nombre: 'Marino',
  tela: { id: 1, nombre: 'Felpa Suiza', nombreComplemento: 'Cardigan' },
};

describe('la Σ del conteo sale de los MOVIMIENTOS, nunca de la vista', () => {
  const sesionMover = () =>
    sesionDePrueba({ permisos: ['inventario-telas.ver', 'inventario-telas.mover'] });

  it('APLICAR: lee `movimiento_det_tela`, jamás `existencia_tela_color`, y SÍ toma el lock', async () => {
    const capturas: SqlCapturado[] = [];
    const { tx } = clienteEspia(capturas, [{ cuerpo: 100, complemento: 40 }], [COLOR_ESPIA]);
    // Conteo que CUADRA: el dominio sale temprano sin escribir, pero ya leyó el saldo.
    const salida = await registrarConteoTelaColor(
      sesionMover(),
      {
        idAlmacen: 5,
        fecha: '2026-09-03',
        motivo: 'conteo que cuadra',
        lineas: [{ idTelaColor: 11, contadoCuerpo: 100, contadoComplemento: 40 }],
      },
      { tx },
    );
    expect(salida.sinDiferencias).toBe(true);

    const todo = capturas.map((c) => c.sql).join('\n');
    // (a) la fuente es la TABLA de movimientos…
    expect(todo).toContain('movimiento_det_tela');
    // (b) …y la vista no aparece por ningún lado.
    expect(todo).not.toContain('existencia_tela_color');
    // (c) el camino de APLICAR sí se serializa: ahí vive la garantía contra el saldo viejo.
    expect(capturas.some((c) => c.sql.includes('pg_advisory_xact_lock'))).toBe(true);
  });

  it('LEER los saldos: misma tabla, misma ausencia de vista… y SIN lock (control negativo)', async () => {
    const capturas: SqlCapturado[] = [];
    const { cliente } = clienteEspia(
      capturas,
      [{ idTelaColor: 11, cuerpo: 70, complemento: 30 }],
      [COLOR_ESPIA],
    );
    const salida = await saldosTelaColorParaConteo(
      sesionMover(),
      { idAlmacen: 5, idTelaColor: '11' },
      { cliente },
    );
    expect(salida.saldos).toHaveLength(1);

    const todo = capturas.map((c) => c.sql).join('\n');
    expect(todo).toContain('movimiento_det_tela');
    expect(todo).not.toContain('existencia_tela_color');
    // El control que separa los dos mundos: una LECTURA de consulta no bloquea a nadie. Si alguien
    // devolviera el `bloquearTelaColor` a este camino, esta línea lo caza.
    expect(todo).not.toContain('pg_advisory_xact_lock');
    // Y pide sus colores AGRUPADOS: una sola consulta, no una por renglón.
    expect(todo).toContain('GROUP BY');
  });
});

describe('saldos para el conteo: los colores SIN movimientos vuelven en CERO, no ausentes', () => {
  const sesionVer = () => sesionDePrueba({ permisos: ['inventario-telas.ver'] });

  it('🔴 pide 3 colores, sólo 1 tiene movimientos → vuelven LOS 3, los otros dos en 0', async () => {
    // El `GROUP BY` OMITE los colores sin ningún movimiento. En la pantalla del arranque «sin
    // dato» y «cero» no son lo mismo: un color nuevo tiene que enseñar 0, no blanco. Si el relleno
    // se cayera, aquí volverían 1 saldo en vez de 3.
    const capturas: SqlCapturado[] = [];
    const { cliente } = clienteEspia(
      capturas,
      // Sólo el 11 salió del GROUP BY; el 21 y el 31 no tienen NINGÚN movimiento.
      [{ idTelaColor: 11, cuerpo: 70, complemento: 30 }],
      [
        COLOR_ESPIA,
        {
          id: 21,
          nombre: 'Blanco',
          tela: { id: 1, nombre: 'Felpa Suiza', nombreComplemento: 'Cardigan' },
        },
        {
          id: 31,
          nombre: 'Negro',
          tela: { id: 2, nombre: 'Lisa Algodón', nombreComplemento: null },
        },
      ],
    );

    const salida = await saldosTelaColorParaConteo(
      sesionVer(),
      { idAlmacen: 5, idTelaColor: '11,21,31' },
      { cliente },
    );

    expect(salida.saldos).toHaveLength(3);
    expect(salida.saldos.map((s) => s.idTelaColor)).toEqual([11, 21, 31]);
    // El que sí tiene movimientos trae su Σ…
    expect(salida.saldos[0]).toMatchObject({ cuerpo: 70, complemento: 30 });
    // …y los que no, un CERO de verdad (número), no `undefined` ni ausencia de renglón.
    expect(salida.saldos[1]?.cuerpo).toBe(0);
    expect(salida.saldos[1]?.complemento).toBe(0);
    expect(salida.saldos[2]?.cuerpo).toBe(0);
    expect(typeof salida.saldos[1]?.cuerpo).toBe('number');
    expect(typeof salida.saldos[2]?.cuerpo).toBe('number');
    // Y el color de la tela SIN complemento lo reporta como null (no pide ese número).
    expect(salida.saldos[2]?.nombreComplemento).toBeNull();
  });

  it('un color repetido en la lista se responde UNA vez, y los ids van ordenados', async () => {
    const capturas: SqlCapturado[] = [];
    const { cliente } = clienteEspia(
      capturas,
      [],
      [
        COLOR_ESPIA,
        {
          id: 21,
          nombre: 'Blanco',
          tela: { id: 1, nombre: 'Felpa Suiza', nombreComplemento: 'Cardigan' },
        },
      ],
    );
    const salida = await saldosTelaColorParaConteo(
      sesionVer(),
      { idAlmacen: 5, idTelaColor: '21,11,21' },
      { cliente },
    );
    expect(salida.saldos.map((s) => s.idTelaColor)).toEqual([11, 21]);
  });

  it('un color que no existe revienta (no se inventa un saldo en 0 para él)', async () => {
    // El relleno a 0 es para colores REALES sin movimientos; un id inexistente es otra cosa y no
    // puede colarse como "existe y tiene cero".
    const capturas: SqlCapturado[] = [];
    const { cliente } = clienteEspia(capturas, [], [COLOR_ESPIA]);
    await expect(
      saldosTelaColorParaConteo(sesionVer(), { idAlmacen: 5, idTelaColor: '11,99' }, { cliente }),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('la lista de colores del querystring se trocea en el dominio', () => {
  it('trocea, quita repetidos y ordena', () => {
    expect(idsDeColorPedidos('21,11,21')).toEqual([11, 21]);
    expect(idsDeColorPedidos(' 33 , 4 ')).toEqual([4, 33]);
  });

  it('rechaza lo que no es un id entero positivo (no lo cuela como NaN ni como 0)', () => {
    // `Number('')` es 0 y `Number('x')` es NaN: colarlos haría un `IN (...)` silenciosamente vacío
    // o roto. Se rechaza en la puerta.
    for (const malo of ['', ' , ', '11,x', '11,-3', '11,0', '11,2.5']) {
      expect(() => idsDeColorPedidos(malo), malo).toThrow(ErrorValidacion);
    }
  });

  // 🔴 La hermana que faltaba. Las cinco malformadas de arriba reciben su `ErrorValidacion`; estas
  // tres PASABAN el guard y llegaban a `findMany` contra una columna `Int` (int4), reventando abajo
  // en la capa de datos con un error que no es el 400 que le toca.
  it('🔴 rechaza los ids que NO CABEN en la columna (int4), en vez de dejarlos llegar a la BD', () => {
    // int4 máx + 1: es un entero perfectamente "seguro" en JS, así que sólo el tope de la columna
    // lo caza.
    expect(() => idsDeColorPedidos('2147483648')).toThrow(ErrorValidacion);
    // Rama CONTRARIA a la de la precisión: 2147483648 sí es un entero exacto, así que lo que
    // sobra es el rango. Las dos ramas quedan observables por su mensaje.
    expect(() => idsDeColorPedidos('2147483648')).toThrow(/rango de ids válidos/);
    expect(() => idsDeColorPedidos('11,2147483648')).toThrow(ErrorValidacion);
    // …y el límite exacto SÍ pasa (control: el guard no se pasa de estricto).
    expect(idsDeColorPedidos('2147483647')).toEqual([2147483647]);
  });

  it('🔴 rechaza el número gigantesco (1e20), y lo diagnostica como precisión, no como rango', () => {
    expect(() => idsDeColorPedidos('99999999999999999999')).toThrow(ErrorValidacion);
    expect(() => idsDeColorPedidos('99999999999999999999')).toThrow(/exactitud/);
  });

  it('⭐ rechaza el que PIERDE PRECISIÓN EN SILENCIO — el peor de los tres', () => {
    // `Number('9007199254740993')` da 9007199254740992: JavaScript se come el último dígito SIN
    // avisar. No truena: MIENTE. Antes pasaba el guard con un id que el usuario nunca escribió.
    const tecleado = '9007199254740993';
    // Control: el fixture DE VERDAD pierde precisión (si dejara de hacerlo, esta prueba no probaría
    // nada de lo que dice su nombre).
    expect(String(Number(tecleado))).not.toBe(tecleado);
    expect(Number.isSafeInteger(Number(tecleado))).toBe(false);

    expect(() => idsDeColorPedidos(tecleado)).toThrow(ErrorValidacion);
    // ⭐ Y lo que se DIAGNOSTICA es la precisión, NO el rango. Sin esta línea la prueba pasaba
    // igual con el guard de precisión borrado —el tope de int4 caza los tres números—, o sea que
    // `Number.isSafeInteger` habría sido código muerto con una justificación decorativa. Lo cazó
    // una mutación (MUT-O2, que antes sobrevivía 29/29).
    expect(() => idsDeColorPedidos(tecleado)).toThrow(/exactitud/);
    expect(() => idsDeColorPedidos(tecleado)).not.toThrow(/rango de ids válidos/);
    // Y el mensaje cita lo que se TECLEÓ, no el número ya redondeado: echarle en cara un
    // «…992» que nunca escribió sería el mismo defecto con otra cara.
    expect(() => idsDeColorPedidos(tecleado)).toThrow(/9007199254740993/);
    expect(() => idsDeColorPedidos(tecleado)).not.toThrow(/9007199254740992/);
  });

  it('el borde de la precisión: MAX_SAFE_INTEGER falla por rango, no por precisión', () => {
    // Control negativo del caso de arriba: 2^53−1 SÍ es exacto, así que lo que lo rechaza es el
    // tope de la columna. Los dos guards existen por razones distintas y no se tapan entre sí.
    expect(Number.isSafeInteger(Number('9007199254740991'))).toBe(true);
    expect(() => idsDeColorPedidos('9007199254740991')).toThrow(/rango de ids válidos/);
  });

  it('topa la consulta: un querystring no es un volcado del catálogo', () => {
    const muchos = Array.from({ length: 501 }, (_, i) => String(i + 1)).join(',');
    expect(() => idsDeColorPedidos(muchos)).toThrow(ErrorValidacion);
    const justos = Array.from({ length: 500 }, (_, i) => String(i + 1)).join(',');
    expect(idsDeColorPedidos(justos)).toHaveLength(500);
  });
});
