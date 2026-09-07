import { describe, expect, it } from 'vitest';

import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  aCantidadTela,
  calcularDeltasConteo,
  idsDeColorPedidos,
  registrarConteoTelaColor,
  repartirPorPartidaFifo,
  saldosTelaColorParaConteo,
  type ColorConTela,
  type LineaColorBase,
  type LineaConteoBase,
  type SaldoConteo,
  type SaldoPartidaTela,
} from './partidas-telas.js';
import type { ExistenciaTelaColor } from '../../comun/kardex.js';

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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐⭐ FILA 0.142 — EL REPARTO FIFO DEL TRASPASO ENTRE LOS LOTES DEL ORIGEN
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// `repartirPorPartidaFifo` es PURA: aquí se fija la REGLA (de qué lotes sale la tela que se mueve),
// y en `partidas-telas.int.test.ts` se fija que esa regla llegue de verdad a las dos patas del
// kardex bajo el lock del origen. Lo que estas pruebas vigilan, y que antes no vigilaba nadie:
//  • que sea FIFO por FOLIO de partida y no por id ni por el orden en que la base los devuelva;
//  • que CUERPO y COMPLEMENTO se repartan por SEPARADO (son dos existencias independientes, y hay
//    partidas de sólo cardigan) y luego se junten POR PARTIDA en un renglón;
//  • que lo que ningún lote explique salga con `null` y sin reventar (REGLA 0-B: la tela vieja no
//    tiene lote y no se le inventa uno);
//  • que un lote agotado (o en negativo) no se ofrezca.

/** Un saldo por lote del almacén de origen. */
function saldoLote(
  idPartida: number,
  folio: number,
  idTelaColor: number,
  cuerpo: number,
  complemento = 0,
): SaldoPartidaTela {
  return { idPartida, idTelaColor, folio, cuerpo, complemento };
}

/** Un renglón capturado en la pantalla de traspaso. */
function capturado(
  idTelaColor: number,
  cantidad: number,
  cantidadComplemento?: number,
): LineaColorBase {
  return cantidadComplemento === undefined
    ? { idTelaColor, cantidad }
    : { idTelaColor, cantidad, cantidadComplemento };
}

/**
 * La existencia REAL por color cuando NO hay déficit: exactamente lo que los lotes dicen tener. Es
 * el tercer argumento del reparto, y estas pruebas lo pasan así para decir *«este caso no va del
 * tope»*. El tope tiene sus propias pruebas más abajo, con la existencia por debajo de la Σ.
 */
function sinDeficit(saldos: readonly SaldoPartidaTela[]): Map<number, ExistenciaTelaColor> {
  const m = new Map<number, ExistenciaTelaColor>();
  for (const s of saldos) {
    const acum = m.get(s.idTelaColor) ?? { cuerpo: 0, complemento: 0 };
    m.set(s.idTelaColor, {
      cuerpo: acum.cuerpo + Math.max(0, s.cuerpo),
      complemento: acum.complemento + Math.max(0, s.complemento),
    });
  }
  return m;
}

/** La existencia REAL por color, dictada a mano (para los casos del TOPE). */
function existenciasReales(
  ...filas: [number, number, number?][]
): Map<number, ExistenciaTelaColor> {
  return new Map(filas.map(([id, cuerpo, comp]) => [id, { cuerpo, complemento: comp ?? 0 }]));
}

/** Lo repartido, en la forma en la que es fácil de leer: [partida, cuerpo, complemento]. */
function comoTerna(
  r: ReturnType<typeof repartirPorPartidaFifo>,
): [number | null, number, number | undefined][] {
  return r.lineas.map((l, i) => [
    r.idPartidaPorLinea[i] ?? null,
    l.cantidad,
    l.cantidadComplemento,
  ]);
}

describe('reparto FIFO del traspaso (fila 0.142)', () => {
  it('un solo lote que alcanza: un renglón, con SU partida', () => {
    const r = repartirPorPartidaFifo(
      [capturado(11, 300)],
      [saldoLote(1, 501, 11, 800)],
      sinDeficit([saldoLote(1, 501, 11, 800)]),
    );
    expect(comoTerna(r)).toEqual([[1, 300, 0]]);
  });

  it('⭐ va del folio MÁS VIEJO al más nuevo, aunque los saldos lleguen AL REVÉS', () => {
    // Se pasan DESORDENADOS a propósito: si la función se fiara del orden en que llegan (o del id),
    // este caso saldría al revés y nadie lo notaría — los dos renglones existirían igual y las
    // cantidades sumarían lo mismo. La partida 9 tiene el folio 502 y el id más alto: si mandara el
    // id o el orden del arreglo, se llevaría los primeros 500.
    const r = repartirPorPartidaFifo(
      [capturado(11, 700)],
      [saldoLote(9, 502, 11, 500), saldoLote(1, 501, 11, 300)],
      sinDeficit([saldoLote(9, 502, 11, 500), saldoLote(1, 501, 11, 300)]),
    );
    expect(comoTerna(r)).toEqual([
      [1, 300, 0],
      [9, 400, 0],
    ]);
  });

  it('lo que ningún lote alcanza a explicar viaja SIN lote, y no truena', () => {
    // El caso normal de la tela vieja: entró por un traspaso anterior a la 0.142, así que no tiene
    // partida y nadie se la va a inventar (REGLA 0-B).
    const r = repartirPorPartidaFifo(
      [capturado(11, 500)],
      [saldoLote(1, 501, 11, 200)],
      // La existencia es MAYOR que lo que los lotes explican: 500 en el anaquel y sólo 200 con
      // nombre. El tope no quita nada (no hay déficit) y los 300 restantes viajan sin lote.
      existenciasReales([11, 500]),
    );
    expect(comoTerna(r)).toEqual([
      [1, 200, 0],
      [null, 300, 0],
    ]);
  });

  it('sin NINGÚN lote en el origen, todo viaja sin lote (un solo renglón)', () => {
    const r = repartirPorPartidaFifo(
      [capturado(11, 500, 40)],
      [],
      existenciasReales([11, 500, 40]),
    );
    expect(comoTerna(r)).toEqual([[null, 500, 40]]);
  });

  it('⭐⭐ CUERPO y COMPLEMENTO se reparten POR SEPARADO y se juntan por partida', () => {
    // Dos existencias independientes: el lote viejo tiene cuerpo y nada de cardigan; el nuevo, al
    // revés. Repartir sólo el cuerpo (o arrastrar el cardigan con él) daría un reparto imposible.
    const r = repartirPorPartidaFifo(
      [capturado(11, 500, 60)],
      [saldoLote(1, 501, 11, 400, 0), saldoLote(2, 502, 11, 300, 100)],
      sinDeficit([saldoLote(1, 501, 11, 400, 0), saldoLote(2, 502, 11, 300, 100)]),
    );
    expect(comoTerna(r)).toEqual([
      [1, 400, 0],
      [2, 100, 60],
    ]);
  });

  it('⭐ una partida de SÓLO complemento nombra el cardigan aunque no aporte cuerpo', () => {
    // Comprar cardigan suelto es un caso REAL (§Post-F9.11 punto 2): esa partida tiene cuerpo 0.
    const r = repartirPorPartidaFifo(
      [capturado(11, 0, 120)],
      [saldoLote(1, 501, 11, 0, 200)],
      sinDeficit([saldoLote(1, 501, 11, 0, 200)]),
    );
    expect(comoTerna(r)).toEqual([[1, 0, 120]]);
  });

  it('un lote AGOTADO (o en negativo) no se ofrece: se salta al siguiente', () => {
    const r = repartirPorPartidaFifo(
      [capturado(11, 250)],
      [saldoLote(1, 501, 11, 0), saldoLote(2, 502, 11, -30), saldoLote(3, 503, 11, 400)],
      sinDeficit([
        saldoLote(1, 501, 11, 0),
        saldoLote(2, 502, 11, -30),
        saldoLote(3, 503, 11, 400),
      ]),
    );
    expect(comoTerna(r)).toEqual([[3, 250, 0]]);
  });

  it('🔴 un lote con CUERPO en negativo y complemento vivo NO reparte una cantidad negativa', () => {
    // El caso feo: un inverso de corrección dejó el cuerpo de ese lote en −30 mientras su cardigan
    // sigue vivo. Sin acotar el saldo a 0, `min(resta, −30)` daría un renglón de kardex con
    // cantidad NEGATIVA — que el motor sí acepta en la validación por color (el signo lo pone la
    // dirección) y que descuadraría el saldo por lote en el destino.
    const r = repartirPorPartidaFifo(
      [capturado(11, 100, 40)],
      [saldoLote(1, 501, 11, -30, 200)],
      // 100 kg de cuerpo en el anaquel que ningún lote explica (el suyo está en negativo).
      existenciasReales([11, 100, 200]),
    );
    expect(comoTerna(r)).toEqual([
      [1, 0, 40],
      [null, 100, 0],
    ]);
  });

  it('cada COLOR se reparte contra SUS lotes (los de otro color no lo tocan)', () => {
    const r = repartirPorPartidaFifo(
      [capturado(11, 100), capturado(21, 50)],
      [saldoLote(1, 501, 11, 400), saldoLote(2, 502, 21, 30)],
      sinDeficit([saldoLote(1, 501, 11, 400), saldoLote(2, 502, 21, 30)]),
    );
    expect(comoTerna(r)).toEqual([
      [1, 100, 0],
      [2, 30, 0],
      [null, 20, 0],
    ]);
  });

  it('el ruido decimal no inventa un renglón de una millonésima', () => {
    // 0.1 + 0.2 = 0.30000000000000004 en binario: sin redondear a los 4 decimales de la columna,
    // el remanente quedaría en 4.4e-17 y saldría un renglón fantasma SIN lote.
    const r = repartirPorPartidaFifo(
      [capturado(11, 0.3)],
      [saldoLote(1, 501, 11, 0.1), saldoLote(2, 502, 11, 0.2)],
      sinDeficit([saldoLote(1, 501, 11, 0.1), saldoLote(2, 502, 11, 0.2)]),
    );
    expect(comoTerna(r)).toEqual([
      [1, 0.1, 0],
      [2, 0.2, 0],
    ]);
  });

  it('⭐ el remanente redondeado evita el RENGLÓN FANTASMA sin lote', () => {
    // 1.0 − 0.7 da 0.30000000000000004 en binario; al restarle el segundo lote (0.3) queda
    // 5.5e-17 > 0 y, sin redondear el remanente, saldría un TERCER renglón sin lote con cantidad
    // «cero» — un renglón de kardex que no representa nada y que además saldría impreso en la hoja
    // del traspaso con el lote en «—».
    const r = repartirPorPartidaFifo(
      [capturado(11, 1)],
      [saldoLote(1, 501, 11, 0.7), saldoLote(2, 502, 11, 0.3)],
      sinDeficit([saldoLote(1, 501, 11, 0.7), saldoLote(2, 502, 11, 0.3)]),
    );
    expect(comoTerna(r)).toEqual([
      [1, 0.7, 0],
      [2, 0.3, 0],
    ]);
  });

  it('lo repartido SUMA exactamente lo capturado (no se pierde ni se inventa tela)', () => {
    const r = repartirPorPartidaFifo(
      [capturado(11, 1234.5678, 90.1234)],
      [saldoLote(1, 501, 11, 1000, 50), saldoLote(2, 502, 11, 100, 10)],
      sinDeficit([saldoLote(1, 501, 11, 1000, 50), saldoLote(2, 502, 11, 100, 10)]),
    );
    const sumaCuerpo = aCantidadTela(r.lineas.reduce((t, l) => t + l.cantidad, 0));
    const sumaComp = aCantidadTela(r.lineas.reduce((t, l) => t + (l.cantidadComplemento ?? 0), 0));
    expect(sumaCuerpo).toBe(1234.5678);
    expect(sumaComp).toBe(90.1234);
    // …y el arreglo de partidas va PARALELO a las líneas, que es de lo que depende `aLineasMotor`.
    expect(r.idPartidaPorLinea).toHaveLength(r.lineas.length);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 🔴 EL TOPE CONTRA LA EXISTENCIA REAL — el hallazgo GRAVE de la ronda de corrección
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  //
  // El saldo por lote viene INFLADO porque las salidas a orden no nombran lote (P3). Sin tope, el
  // FIFO se lleva el folio más viejo AUNQUE YA ESTÉ CONSUMIDO, y el destino —y la hoja impresa—
  // reciben el nombre de un lote que no es. Eso es PEOR que el estado anterior a esta fila: cambia
  // un «no sé» honesto por una afirmación falsa dicha con confianza.

  it('🔴 NO nombra un lote que la existencia real ya no respalda (el escenario del reviewer)', () => {
    // Los cuatro pasos, medidos contra la base por el reviewer y reproducidos aquí en puro:
    //  1. entran 500 de L-VIEJO   2. salen 500 a una orden (no nombra lote)
    //  3. entran 300 de L-NUEVO   4. se traspasan esos 300
    // Σ saldos = 800 (L-VIEJO sigue diciendo 500), pero en el anaquel sólo hay 300, y son L-NUEVO.
    const saldos = [saldoLote(1, 501, 11, 500), saldoLote(2, 502, 11, 300)];
    const r = repartirPorPartidaFifo([capturado(11, 300)], saldos, existenciasReales([11, 300]));
    // Sin el tope esto decía [[1, 300, 0]] — L-VIEJO, que ya no existe.
    expect(comoTerna(r)).toEqual([[2, 300, 0]]);
  });

  it('🔴 el déficit se quita del más VIEJO al más nuevo (misma hipótesis FIFO del reparto)', () => {
    // Σ saldos = 900, existencia = 400 ⇒ déficit 500: se lo come L-VIEJO entero (300) y 200 del
    // segundo. Quedan 100 del segundo y 300 del tercero.
    const saldos = [
      saldoLote(1, 501, 11, 300),
      saldoLote(2, 502, 11, 300),
      saldoLote(3, 503, 11, 300),
    ];
    const r = repartirPorPartidaFifo([capturado(11, 400)], saldos, existenciasReales([11, 400]));
    expect(comoTerna(r)).toEqual([
      [2, 100, 0],
      [3, 300, 0],
    ]);
  });

  it('🔴 el déficit se calcula POR COMPONENTE (el cardigan no arrastra al cuerpo)', () => {
    // El cuerpo está inflado (Σ 800 contra 300 reales) y el complemento no (Σ 200 contra 200).
    // Un déficit calculado sobre la suma de los dos componentes castigaría al cardigan sin motivo.
    const saldos = [saldoLote(1, 501, 11, 500, 100), saldoLote(2, 502, 11, 300, 100)];
    const r = repartirPorPartidaFifo(
      [capturado(11, 300, 200)],
      saldos,
      existenciasReales([11, 300, 200]),
    );
    expect(comoTerna(r)).toEqual([
      [1, 0, 100],
      [2, 300, 100],
    ]);
  });

  // ⚠️⚠️ AQUÍ VIVÍA UNA PRUEBA VACUA, y se cuenta para que no vuelva. Decía «INVARIANTE: nunca se
  // nombra más tela de la que los lotes pueden explicar» y **pasaba con el tope BORRADO**, porque esa
  // propiedad no la da el tope: la da `validarNoNegativoTelaColor` (rechaza la captura si pasa de la
  // existencia) más el hecho de que el reparto nunca reparte más de lo capturado. El único estado en
  // que el tope la sostendría —dos renglones del mismo color en una captura— lo prohíbe
  // `resolverColores`. La cazó el reviewer y la reprodujo el coder: 4 rojas al borrar el tope, y
  // ésta verde. Su sustituta fija la propiedad REAL, que es de identidad y no de cantidad.

  it('⭐ el tope cambia CUÁL lote se nombra, NO cuánta tela se nombra', () => {
    // Mismo capturado y misma existencia; lo único que cambia entre tener tope y no tenerlo es el
    // lote elegido. Se afirman las DOS mitades a la vez:
    //  · la cantidad total repartida es EXACTAMENTE la capturada (el tope no se come nada), y
    //  · el lote es el que la existencia respalda, no el más viejo que ya se consumió.
    // Con el tope borrado la segunda mitad se pone roja; sin la primera, un tope demasiado goloso
    // pasaría inadvertido mandando tela sin nombre.
    const saldos = [saldoLote(1, 501, 11, 500), saldoLote(2, 502, 11, 300)];
    const r = repartirPorPartidaFifo([capturado(11, 300)], saldos, existenciasReales([11, 300]));

    expect(aCantidadTela(r.lineas.reduce((t, l) => t + l.cantidad, 0))).toBe(300);
    expect(r.idPartidaPorLinea).toEqual([2]);
    // Y nada viaja sin lote: la existencia entera está respaldada por el lote nuevo.
    expect(r.idPartidaPorLinea.filter((id) => id === null)).toEqual([]);
  });

  it('sin déficit el tope NO quita nada (no castiga al almacén que sí cuadra)', () => {
    // El caso normal de una bodega alimentada sólo por compras: la existencia es exactamente lo que
    // los lotes explican. Un tope demasiado goloso mandaría tela sin nombre aquí.
    const saldos = [saldoLote(1, 501, 11, 500), saldoLote(2, 502, 11, 300)];
    const r = repartirPorPartidaFifo([capturado(11, 700)], saldos, existenciasReales([11, 800]));
    expect(comoTerna(r)).toEqual([
      [1, 500, 0],
      [2, 200, 0],
    ]);
  });

  it('con MÁS existencia que lotes (tela sin nombre en el origen) el tope no inventa nada', () => {
    // 800 en el anaquel, sólo 300 con nombre: los 500 restantes viajan sin lote, como debe ser.
    const saldos = [saldoLote(1, 501, 11, 300)];
    const r = repartirPorPartidaFifo([capturado(11, 800)], saldos, existenciasReales([11, 800]));
    expect(comoTerna(r)).toEqual([
      [1, 300, 0],
      [null, 500, 0],
    ]);
  });

  it('un color SIN existencia declarada se trata como anaquel vacío: nada se nombra', () => {
    // Defensa: si el mapa no trae el color (no debería pasar — lo llena la validación bajo lock),
    // el tope asume 0 y nada se nombra. Prefiere callar antes que nombrar a ciegas.
    const r = repartirPorPartidaFifo(
      [capturado(11, 100)],
      [saldoLote(1, 501, 11, 400)],
      existenciasReales([99, 400]),
    );
    expect(comoTerna(r)).toEqual([[null, 100, 0]]);
  });

  it('un renglón capturado en 0/0 NO desaparece: sale sin lote para que lo rechace el motor', () => {
    // El contrato ya lo rechaza antes (`alMenosUnaCantidad`), pero si esta función lo tragara en
    // silencio un movimiento podría acabar con menos renglones de los capturados.
    const r = repartirPorPartidaFifo(
      [capturado(11, 0, 0)],
      [saldoLote(1, 501, 11, 400)],
      sinDeficit([saldoLote(1, 501, 11, 400)]),
    );
    expect(comoTerna(r)).toEqual([[null, 0, 0]]);
  });
});
