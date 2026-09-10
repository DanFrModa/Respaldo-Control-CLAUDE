/**
 * ⭐ LA BANDEJA DE CxP, PARTIDA EN DOS RELACIONES DE PAGO (fila 0.132, §Post-F9.192(5)).
 *
 * Daniel, sobre la bandeja del viernes ("a quién le debo"): *«debería partirse en Con factura / Sin
 * factura, con totales y antigüedad por separado, porque son dos relaciones de pago distintas»*.
 *
 * Lo que este archivo prueba, sin base de datos:
 *  1. **El contrato**: `segmento` nace en `todos` cuando nadie lo pide (la bandeja de siempre) y un
 *     valor inventado se RECHAZA en vez de colarse hasta el SQL.
 *  2. **La traducción**: `todos` → `undefined` (no segmentar), y `con`/`sin` viajan tal cual.
 *  3. **Que el segmento LLEGA A LAS DOS FUENTES y el RESUMEN es el del segmento** — que es la mitad
 *     que de verdad importa: si los KPIs siguieran siendo los de la cartera completa, el listado
 *     "Sin factura" enseñaría un total que no es el suyo, y ese total es justo lo que se va a pagar.
 *  4. **Que la bandeja SÍ pide los DÍAS VENCIDOS y los ENSEÑA** (fila 0.186; **DANIEL:** *«sí, un
 *     campo de días vencidos sí»*). Este punto medía lo contrario hasta la 0.186 —la 0.166 le había
 *     quitado a la bandeja dos `GROUP BY` por carga cuyo resultado se tiraba— y se invirtió cuando
 *     la columna entró al contrato. El criterio de la 0.166 no cambió: **no se paga por lo que no
 *     se enseña**; lo que cambió es que ahora sí se enseña.
 *
 * ⚠️ Qué se dobla y qué NO (mismo criterio que `salida-produccion.test.ts`): se doblan las dos
 * FUENTES —el agregado SQL del motor y el aporte EsMa— y el resto corre de verdad: el netting del
 * aging, los dos cortes (`conSaldo`/`visibles`), el resumen y la paginación son código real. El
 * doble del motor INTERPRETA la consulta que recibe (lee el fragmento `es_fiscal` que le mandaron),
 * así que si el segmento dejara de viajar al SQL las cifras de abajo cambiarían solas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConvivenciaEsMa from '../convivencia-esma.js';

import { esquemaBandejaCxpQuery } from '../../../contrato/index.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { Prisma } from '../../../datos/index.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { armarPendiente, PENDIENTE_VACIO } from '../../esma/formula-saldo.js';

import { segmentoCartera } from './facturacion-cxp.js';

/** Lo que el doble de EsMa recibió como segmento en la última llamada (`undefined` = sin segmentar). */
const aportesEsMa = vi.fn();

vi.mock('../convivencia-esma.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ConvivenciaEsMa>()),
  aportesEsMaSaldoLote: (...a: unknown[]) => aportesEsMa(...a) as unknown,
}));

const { bandejaPorPagar } = await import('./cxp.js');

const SESION = sesionDePrueba({
  idEmpresaActiva: 1,
  permisos: ['cxp.ver', 'terceros.ver', 'consultas.ver-importes'],
});

/** Los tres segmentos, tal como los nombra el contrato. */
type Segmento = 'todos' | 'con' | 'sin';

// ── El escenario, el mismo que la prueba de integración ────────────────────────────────────────────
//
// • Hilaturas del Norte (7): 1,000 en el motor CON factura.
// • Avíos del Centro   (8):   400 en el motor SIN factura.
// • Maquilas del Sur   (9):   300 de maquila EsMa con `con_factura` SIN DEFINIR → cuenta como "sin".
//
// ⇒ con = 1,000 · sin = 700 · todos = 1,700. Y `con + sin = todos`, que es la promesa de la
//   partición: ningún peso se cae de las dos relaciones.

/** Una fila CRUDA del agregado del motor (los subtotales viajan en `numeric` → Decimal). */
function filaMotor(
  idProveedor: number,
  proveedor: string,
  corriente: number,
): Record<string, unknown> {
  const cero = new Prisma.Decimal(0);
  return {
    idProveedor,
    proveedor,
    nombreCorto: null,
    diasCredito: 30,
    corriente: new Prisma.Decimal(corriente),
    d1a30: cero,
    d31a60: cero,
    mas60: cero,
    creditos: cero,
  };
}

const CON_FACTURA = filaMotor(7, 'Hilaturas del Norte', 1000);
const SIN_FACTURA = filaMotor(8, 'Avíos del Centro', 400);

/** Filas del motor que el doble devuelve para cada segmento. */
const FILAS_MOTOR: Record<Segmento, Record<string, unknown>[]> = {
  todos: [CON_FACTURA, SIN_FACTURA],
  con: [CON_FACTURA],
  sin: [SIN_FACTURA],
};

/** Aporte EsMa por segmento: el maquilero sin definir sólo existe en "sin" (y en "todos"). */
function aporteEsMaDe(segmento: Segmento): Map<number, unknown> {
  const vacio = new Map<number, unknown>();
  if (segmento === 'con') {
    return vacio;
  }
  return new Map<number, unknown>([
    [9, { saldo: 300, pendiente: armarPendiente(PENDIENTE_VACIO) }],
  ]);
}

/**
 * QUÉ SEGMENTO PIDIÓ la consulta, leído de la consulta MISMA. El doble hace de Postgres: si el
 * fragmento `AND m.es_fiscal = $n` no está, no se segmentó; si está, el booleano que lleva pegado
 * dice cuál de los dos. Es a propósito que el doble tenga que interpretarlo: así, si el parámetro
 * dejara de llegar al SQL, esta prueba se cae sola en vez de pasar en verde con la cartera entera.
 */
function segmentoDeLaConsulta(consulta: Prisma.Sql): Segmento {
  // Las dos redacciones de la misma condición: el aging la escribe sin comillas y el agregado de
  // días vencidos con ellas. Se aceptan las dos a propósito, para que el doble no obligue a
  // escribir el SQL de una forma concreta.
  if (!consulta.sql.includes('m.es_fiscal =') && !consulta.sql.includes('m."es_fiscal" =')) {
    return 'todos';
  }
  return consulta.values.includes(true) ? 'con' : 'sin';
}

/** El último SQL que el motor emitió (para afirmar sobre él sin adivinar). */
let ultimoSql: Prisma.Sql | null = null;
/** El último SQL de los DÍAS VENCIDOS (fila 0.121), para lo mismo. */
let ultimoSqlDias: Prisma.Sql | null = null;

/**
 * ⭐ Fila 0.121 — los cargos fechados que el agregado de DÍAS VENCIDOS devuelve, por segmento. La
 * antigüedad de cada uno la calcula Postgres (`CURRENT_DATE − vencimiento`), así que el doble la
 * entrega ya hecha, igual que la haría la base: Hilaturas (con factura) lleva 40 días y Avíos (sin)
 * lleva 5.
 */
const CARGOS_FECHADOS: Record<Segmento, Record<string, unknown>[]> = {
  todos: [
    { idProveedor: 7, diasAtraso: 40, importe: new Prisma.Decimal(1000) },
    { idProveedor: 8, diasAtraso: 5, importe: new Prisma.Decimal(400) },
  ],
  con: [{ idProveedor: 7, diasAtraso: 40, importe: new Prisma.Decimal(1000) }],
  sin: [{ idProveedor: 8, diasAtraso: 5, importe: new Prisma.Decimal(400) }],
};

/**
 * Cliente de lectura de mentiras: sólo las lecturas que la bandeja hace. `configuracionEmpresa`
 * devuelve `null` → los límites de aging caen en el default 30/60 (código real, no mockeado).
 *
 * ⚠️ La cartera emite UNA consulta cruda —el aging por cubetas— y, sólo cuando le piden la
 * antigüedad (fila 0.166), DOS más: cargos fechados y créditos. El doble las distingue por lo que
 * cada una PIDE —`"diasAtraso"` y `pago_maquilero`—, no por el orden en que llegan: atarlo al orden
 * lo volvería una prueba de la implementación.
 */
function clienteFalso(): ContextoBd {
  const cliente = {
    configuracionEmpresa: { findUnique: () => Promise.resolve(null) },
    $queryRaw: (consulta: Prisma.Sql) => {
      if (consulta.sql.includes('"diasAtraso"')) {
        ultimoSqlDias = consulta;
        return Promise.resolve(CARGOS_FECHADOS[segmentoDeLaConsulta(consulta)]);
      }
      if (consulta.sql.includes('pago_maquilero')) {
        // Créditos de los días vencidos: en este escenario nadie ha pagado nada.
        return Promise.resolve([]);
      }
      ultimoSql = consulta;
      return Promise.resolve(FILAS_MOTOR[segmentoDeLaConsulta(consulta)]);
    },
    proveedor: {
      findMany: () =>
        Promise.resolve([{ id: 9, nombre: 'Maquilas del Sur', nombreCorto: null, diasCredito: 0 }]),
    },
  };
  return { cliente } as unknown as ContextoBd;
}

beforeEach(() => {
  ultimoSql = null;
  ultimoSqlDias = null;
  aportesEsMa.mockReset();
  aportesEsMa.mockImplementation((_cliente: unknown, _idEmpresa: unknown, segmento?: Segmento) =>
    Promise.resolve(aporteEsMaDe(segmento ?? 'todos')),
  );
});

// ── (1) El contrato ────────────────────────────────────────────────────────────────────────────────
describe('contrato: `segmento` de la bandeja de CxP', () => {
  it('sin pedir nada, la bandeja es la de siempre: `todos`', () => {
    expect(esquemaBandejaCxpQuery.parse({}).segmento).toBe('todos');
  });

  it('acepta los dos segmentos de la partición', () => {
    expect(esquemaBandejaCxpQuery.parse({ segmento: 'con' }).segmento).toBe('con');
    expect(esquemaBandejaCxpQuery.parse({ segmento: 'sin' }).segmento).toBe('sin');
  });

  it('⭐ un valor inventado se RECHAZA (no se degrada a "todos" en silencio)', () => {
    // "fiscal" es el error probable: es el vocabulario de LA OTRA partición (la vista del contador).
    for (const malo of ['fiscal', 'CON', 'con-factura', '', 'true']) {
      expect(esquemaBandejaCxpQuery.safeParse({ segmento: malo }).success).toBe(false);
    }
  });
});

// ── (2) La traducción al motor de cartera ─────────────────────────────────────────────────────────
describe('segmentoCartera', () => {
  it('`todos` NO segmenta (undefined); `con`/`sin` viajan tal cual', () => {
    expect(segmentoCartera('todos')).toBeUndefined();
    expect(segmentoCartera('con')).toBe('con');
    expect(segmentoCartera('sin')).toBe('sin');
  });
});

// ── (3) El segmento llega a las DOS fuentes y el resumen es el del segmento ───────────────────────
describe('bandejaPorPagar por segmento', () => {
  it('sin segmento: no filtra ni el motor ni EsMa, y devuelve la cartera completa', async () => {
    const bandeja = await bandejaPorPagar(SESION, {}, clienteFalso());

    expect(ultimoSql?.sql).not.toContain('es_fiscal');
    expect(aportesEsMa).toHaveBeenCalledWith(expect.anything(), 1, undefined);
    expect(bandeja.segmento).toBe('todos');
    expect(bandeja.filas.map((f) => f.idProveedor).sort()).toEqual([7, 8, 9]);
    expect(bandeja.resumen.carteraTotal).toBe(1700);
    expect(bandeja.resumen.maquilaTotal).toBe(300);
    expect(bandeja.resumen.proveedoresConSaldo).toBe(3);
  });

  it('⭐ `con`: filtra las DOS fuentes y el RESUMEN es el de esa relación, no el de la cartera', async () => {
    const bandeja = await bandejaPorPagar(SESION, { segmento: 'con' }, clienteFalso());

    // El parámetro llegó al SQL del motor…
    expect(ultimoSql?.sql).toContain('m.es_fiscal =');
    expect(ultimoSql?.values).toContain(true);
    // …y al aporte de EsMa (que tiene su propio criterio, por su columna nullable).
    expect(aportesEsMa).toHaveBeenCalledWith(expect.anything(), 1, 'con');

    expect(bandeja.segmento).toBe('con');
    expect(bandeja.filas.map((f) => f.idProveedor)).toEqual([7]);
    // 🔴 Los KPIs son los de "con factura": 1,000 — NO los 1,700 de la cartera completa.
    expect(bandeja.resumen.carteraTotal).toBe(1000);
    expect(bandeja.resumen.maquilaTotal).toBe(0);
    expect(bandeja.resumen.proveedoresConSaldo).toBe(1);
  });

  it('⭐ `sin`: trae el no-fiscal del motor Y la maquila sin definir, con su propio resumen', async () => {
    const bandeja = await bandejaPorPagar(SESION, { segmento: 'sin' }, clienteFalso());

    expect(ultimoSql?.sql).toContain('m.es_fiscal =');
    expect(ultimoSql?.values).toContain(false);
    expect(aportesEsMa).toHaveBeenCalledWith(expect.anything(), 1, 'sin');

    expect(bandeja.segmento).toBe('sin');
    expect(bandeja.filas.map((f) => f.idProveedor).sort()).toEqual([8, 9]);
    expect(bandeja.resumen.carteraTotal).toBe(700); // 400 del motor + 300 de maquila
    expect(bandeja.resumen.maquilaTotal).toBe(300);
    expect(bandeja.resumen.proveedoresConSaldo).toBe(2);
  });

  it('⭐ los dos segmentos SUMAN la cartera completa (ningún peso se cae de las dos relaciones)', async () => {
    const todos = await bandejaPorPagar(SESION, {}, clienteFalso());
    const con = await bandejaPorPagar(SESION, { segmento: 'con' }, clienteFalso());
    const sin = await bandejaPorPagar(SESION, { segmento: 'sin' }, clienteFalso());

    expect((con.resumen.carteraTotal ?? 0) + (sin.resumen.carteraTotal ?? 0)).toBe(
      todos.resumen.carteraTotal,
    );
    expect((con.resumen.maquilaTotal ?? 0) + (sin.resumen.maquilaTotal ?? 0)).toBe(
      todos.resumen.maquilaTotal,
    );
  });

  it('el segmento NO toca la paginación ni la búsqueda (siguen aplicándose dentro de él)', async () => {
    const bandeja = await bandejaPorPagar(
      SESION,
      { segmento: 'sin', busqueda: 'maquilas' },
      clienteFalso(),
    );
    // La búsqueda recorta la TABLA…
    expect(bandeja.filas.map((f) => f.idProveedor)).toEqual([9]);
    expect(bandeja.total).toBe(1);
    // …pero NO el resumen, que sigue siendo el de toda la relación "sin factura".
    expect(bandeja.resumen.carteraTotal).toBe(700);
  });
});

// ── (4) Fila 0.121: el segmento también parte los DÍAS VENCIDOS ──────────────────────────────────
describe('⭐ los DÍAS VENCIDOS se piden por el MISMO segmento que la cartera', () => {
  /**
   * La cartera CON antigüedad: la que pide la corrida semanal (fila 0.166), sobre el mismo doble de
   * Postgres que usa la bandeja. Antes esto se medía a través de `bandejaPorPagar` — y por eso no se
   * veía que la bandeja estaba pagando un agregado cuyo resultado tiraba.
   */
  async function carteraConDias(
    segmento?: 'con' | 'sin',
  ): Promise<{ idProveedor: number; diasVencidos: number | null }[]> {
    const { carteraCombinadaConDiasVencidos } = await import('./cxp.js');
    const { cliente } = clienteFalso();
    return carteraCombinadaConDiasVencidos(
      cliente as Parameters<typeof carteraCombinadaConDiasVencidos>[0],
      1,
      { d30: 30, d60: 60 },
      segmento,
    );
  }

  /**
   * Si el segmento no llegara a este agregado, la relación «sin factura» enseñaría la edad de una
   * deuda que se paga en la OTRA relación —y Daniel decide a quién pagar mirando justo ese número—.
   */
  it('sin segmento, el agregado de días tampoco filtra', async () => {
    await carteraConDias();
    expect(ultimoSqlDias?.sql).not.toContain('es_fiscal');
  });

  it('`con` y `sin` viajan hasta el SQL de los días', async () => {
    await carteraConDias('con');
    expect(ultimoSqlDias?.sql).toContain('es_fiscal');
    expect(ultimoSqlDias?.values).toContain(true);

    await carteraConDias('sin');
    expect(ultimoSqlDias?.values).toContain(false);
  });

  it('⭐ cada proveedor recibe SU edad, y el que no tiene cargos fechados se queda sin ella', async () => {
    const dias = new Map((await carteraConDias()).map((f) => [f.idProveedor, f.diasVencidos]));

    expect(dias.get(7)).toBe(40);
    expect(dias.get(8)).toBe(5);
    // Maquilas del Sur (9) sólo existe por su aporte EsMa; en este doble no tiene cargos fechados.
    expect(dias.get(9)).toBeNull();
  });
});

// ── (5) Fila 0.186: la BANDEJA sí paga la antigüedad, PORQUE AHORA LA ENSEÑA ─────────────────────
describe('⭐ la bandeja PIDE el agregado de días vencidos y lo enseña (fila 0.186)', () => {
  /**
   * 🔁 **ESTE BLOQUE ESTÁ INVERTIDO A PROPÓSITO.** Hasta la fila 0.186 medía lo contrario —«ninguno
   * de los tres segmentos emite el SQL de antigüedad»—, y era correcto: `BandejaCxpFila` no llevaba
   * `diasVencidos`, así que la bandeja corría DOS `GROUP BY` de más en cada carga **para tirar el
   * resultado**, y la 0.166 se los quitó.
   *
   * Lo que cambió no es el criterio sino el contrato: **DANIEL** (fila 0.186), preguntado si la
   * bandeja debía enseñar «Días venc.» o dejar de calcularlos, contestó *«sí, un campo de días
   * vencidos sí»*. El trabajo se paga igual que antes; la diferencia es que ahora se cobra en
   * pantalla. El criterio de la 0.166 sigue vivo y sigue siendo el bueno: **no pagar por lo que no
   * se enseña**.
   *
   * Por eso el guardarraíl no se borró: se dio la vuelta. Si alguien «optimizara» la bandeja
   * devolviéndola a `carteraCombinadaPorProveedor`, dejaría de emitirse este SQL y la columna se
   * quedaría muda — y eso es justo lo que estas dos pruebas no dejan pasar en silencio.
   */
  it('los tres segmentos emiten el SQL de antigüedad (una vez por carga)', async () => {
    for (const parametros of [{}, { segmento: 'con' as const }, { segmento: 'sin' as const }]) {
      ultimoSqlDias = null;
      await bandejaPorPagar(SESION, parametros, clienteFalso());
      expect(ultimoSqlDias).not.toBeNull();
    }
  });

  it('⭐ y el número LLEGA a la fila: no se pide para tirarlo', async () => {
    // Emitir el SQL no basta —eso era exactamente el defecto que la 0.166 arregló—: lo que hace
    // útil el gasto es que el dato aterrice en la fila que la pantalla pinta.
    const bandeja = await bandejaPorPagar(SESION, {}, clienteFalso());
    const hilaturas = bandeja.filas.find((f) => f.idProveedor === 7);
    expect(hilaturas).toBeDefined();
    expect(hilaturas?.diasVencidos).toBe(40);
    // El maquilero sin cargos fechados se queda en `null` = «nada que envejecer», no en 0.
    expect(bandeja.filas.find((f) => f.idProveedor === 9)?.diasVencidos).toBeNull();
  });
});

// ── (6) La barrera de COMPILACIÓN que impide el `null` que miente ─────────────────────────────────
describe('los días de una fila que NO los pidió no se pueden ni leer', () => {
  /**
   * 🔴 La mitad delicada de la fila 0.166. `diasVencidos` usa `null` para decir «este proveedor no
   * tiene nada que envejecer»; si la cartera SIN antigüedad devolviera también `null` —por no
   * haberlo calculado—, los dos `null` serían indistinguibles y quien pintara la columna diría «al
   * corriente» de alguien a quien NADIE midió. Por eso el campo no existe en `FilaNeta`: existe sólo
   * en `FilaNetaConDias`, el tipo que devuelve la función que sí paga los dos agregados.
   *
   * `@ts-expect-error` vuelve esa barrera verificable: si alguien devolviera el campo a `FilaNeta`,
   * la línea DEJARÍA de dar error y `tsc` fallaría por una directiva sin uso. Así el guardarraíl no
   * se puede quitar callado (mismo patrón que `comun/jobs/index.test.ts`).
   */
  it('EN NEGATIVO: `FilaNeta` no tiene `diasVencidos` (barrera de COMPILACIÓN)', async () => {
    const { carteraCombinadaPorProveedor } = await import('./cxp.js');
    const { cliente } = clienteFalso();
    const cartera = await carteraCombinadaPorProveedor(
      cliente as Parameters<typeof carteraCombinadaPorProveedor>[0],
      1,
      { d30: 30, d60: 60 },
    );

    const hilaturas = cartera.find((f) => f.idProveedor === 7);

    // 🔴 PRIMERO, que la fila EXISTA. Sin esta línea, el día que `find` no encontrara nada la
    // aserción de abajo pasaría en verde **sin haber mirado una sola fila** — el modo de fallo que
    // este proyecto tiene fichado (una prueba que pasa por la razón equivocada), y encima dentro del
    // guardarraíl que esta fila presenta como su garantía.
    expect(hilaturas).toBeDefined();

    // @ts-expect-error nadie midió la antigüedad de estas filas: el campo NO existe en `FilaNeta`.
    void hilaturas?.diasVencidos;

    // Lo de arriba es la barrera de COMPILACIÓN; ésta es su otra mitad, la de EJECUCIÓN: la llave ni
    // siquiera viaja, así que no hay `null` que nadie pueda confundir con «al corriente». La
    // condición va escrita para morir por LOS DOS lados —si la fila falta **o** si la llave está—,
    // no sólo por el segundo.
    expect(hilaturas === undefined || 'diasVencidos' in hilaturas).toBe(false);
  });
});
