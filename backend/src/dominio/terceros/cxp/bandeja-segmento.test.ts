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
import { armarPendiente } from '../../esma/formula-saldo.js';

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
  return new Map<number, unknown>([[9, { saldo: 300, pendiente: armarPendiente(0, 0, 0, 0) }]]);
}

/**
 * QUÉ SEGMENTO PIDIÓ la consulta, leído de la consulta MISMA. El doble hace de Postgres: si el
 * fragmento `AND m.es_fiscal = $n` no está, no se segmentó; si está, el booleano que lleva pegado
 * dice cuál de los dos. Es a propósito que el doble tenga que interpretarlo: así, si el parámetro
 * dejara de llegar al SQL, esta prueba se cae sola en vez de pasar en verde con la cartera entera.
 */
function segmentoDeLaConsulta(consulta: Prisma.Sql): Segmento {
  if (!consulta.sql.includes('m.es_fiscal =')) {
    return 'todos';
  }
  return consulta.values.includes(true) ? 'con' : 'sin';
}

/** El último SQL que el motor emitió (para afirmar sobre él sin adivinar). */
let ultimoSql: Prisma.Sql | null = null;

/**
 * Cliente de lectura de mentiras: sólo las tres lecturas que la bandeja hace. `configuracionEmpresa`
 * devuelve `null` → los límites de aging caen en el default 30/60 (código real, no mockeado).
 */
function clienteFalso(): ContextoBd {
  const cliente = {
    configuracionEmpresa: { findUnique: () => Promise.resolve(null) },
    $queryRaw: (consulta: Prisma.Sql) => {
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
