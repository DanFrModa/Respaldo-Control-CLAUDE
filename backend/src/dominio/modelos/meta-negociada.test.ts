/**
 * ⭐⭐ V1-E9p (§Post-F9.144(b)) — **LA PROMESA DE LA MESA Y SU DESENLACE**, sin base de datos.
 *
 * Qué fija cada bloque, y por qué:
 *
 *  1. **La BRECHA y el IMPACTO**, que son funciones PURAS: su signo (positivo = se consiguió PEOR)
 *     y —lo que de verdad importa— que **con un dato ausente devuelvan `null` y no `0`**. Un 0 diría
 *     *«se cumplió exacto»* justo cuando no se sabe nada, que es la forma más cara de mentir aquí.
 *  2. **Las dos exigencias del «NO se consiguió»** (el número y el porqué) y, en negativo, que el
 *     «sí» no exija ninguna y que **omitir el desenlace no rompa nada**: es la conducta de siempre.
 *  3. **EL JOIN**, aseverado sobre la SQL que de verdad se manda: que lleve el id del modelo, el de
 *     la empresa, y que **mire también al PADRE**. Ese último trozo es la etapa entera —sin él la
 *     meta sale `null` por el camino normal— y es lo primero que una «simplificación» borraría.
 */
import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { Prisma } from '../../datos/index.js';

import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  brechaDeMeta,
  columnasDelDesenlace,
  CTE_LINAJE_DE_VERSIONES,
  consultarMetaPrometida,
  DESENLACE_BORRADO,
  expedienteDeLaNegociacion,
  impactoDeLaBrecha,
  resolverCostoPrometido,
} from './meta-negociada.js';

// ── 1. LA BRECHA (pura) ───────────────────────────────────────────────────────

describe('brechaDeMeta — el signo', () => {
  it('⭐ POSITIVA cuando se consiguió PEOR de lo prometido (prometí 43, conseguí 45 → +2)', () => {
    // El caso de Daniel: vendió con un costo y la oficina no lo consiguió. El signo es lo que
    // convierte la columna en legible; invertirlo pintaría los incumplimientos como ahorros.
    expect(brechaDeMeta(43, 45)).toBe(2);
  });

  it('NEGATIVA cuando se consiguió mejor de lo prometido (prometí 43, conseguí 40 → −3)', () => {
    expect(brechaDeMeta(43, 40)).toBe(-3);
  });

  it('0 exacto cuando se cumplió al centavo — y ese 0 SÍ significa «se cumplió»', () => {
    expect(brechaDeMeta(43.5, 43.5)).toBe(0);
  });

  it('redondea a 2 decimales, que es la escala de la columna', () => {
    expect(brechaDeMeta(43.005, 45.004)).toBe(2);
  });
});

describe('brechaDeMeta — cuando el dato NO está (REGLA 0-B)', () => {
  /**
   * 🔴 LA aserción que separa «no se sabe» de «se cumplió». Devolver 0 aquí —el error fácil, y el
   * que un `?? 0` introduce sin que nada se ponga rojo— pondría un renglón *«brecha 0»* al lado de
   * una promesa de la que no se sabe nada, y el dueño la leería como cumplida.
   */
  it('⭐ null si falta la META (la versión no vino de una negociación registrada)', () => {
    expect(brechaDeMeta(null, 45)).toBeNull();
    expect(brechaDeMeta(undefined, 45)).toBeNull();
  });

  it('⭐ null si falta lo CONSEGUIDO', () => {
    expect(brechaDeMeta(43, null)).toBeNull();
    expect(brechaDeMeta(43, undefined)).toBeNull();
  });

  it('null si faltan los dos', () => {
    expect(brechaDeMeta(null, null)).toBeNull();
  });

  it('y un 0 de verdad NO se confunde con la ausencia (0 es un número, null no)', () => {
    // Sin esta pareja, un `if (!prometido) return null` pasaría las tres de arriba y rompería el
    // caso real de un costo cero.
    expect(brechaDeMeta(0, 0)).toBe(0);
    expect(brechaDeMeta(0, 5)).toBe(5);
  });
});

describe('impactoDeLaBrecha — lo que la promesa incumplida cuesta', () => {
  it('⭐ brecha × piezas: $2 de más sobre 12,000 piezas son $24,000 de margen', () => {
    expect(impactoDeLaBrecha(2, 12_000)).toBe(24_000);
  });

  it('null si no hay brecha: no se puede multiplicar lo que no se sabe', () => {
    expect(impactoDeLaBrecha(null, 12_000)).toBeNull();
  });

  it('⭐ 0 —y no null— cuando hay brecha pero nadie ha pedido la prenda todavía', () => {
    // Son dos cosas distintas y la pantalla las enseña distinto: «todavía no le cuesta a nadie»
    // (0) no es «no se sabe» (null).
    expect(impactoDeLaBrecha(2, 0)).toBe(0);
  });

  it('conserva el signo: consiguieron mejor de lo prometido ⇒ impacto negativo', () => {
    expect(impactoDeLaBrecha(-1.5, 1000)).toBe(-1500);
  });
});

// ── 2. EL DESENLACE: qué exige el «NO», y qué NO exige el «SÍ» ────────────────

/** Los números salen como `Decimal`; para comparar se leen como número. */
function comoNumero(d: Prisma.Decimal | null): number | null {
  return d === null ? null : d.toNumber();
}

describe('columnasDelDesenlace — «NO se consiguió»', () => {
  it('⭐ escribe el resultado, la META congelada, lo conseguido y el porqué', () => {
    const cols = columnasDelDesenlace(
      { lograda: false, costoConseguido: 45, nota: 'ninguna maquila bajó de $18 con jareta' },
      43,
    );
    // 🔴 `toBe` y NUNCA `toContain`: la cadena 'no_lograda' CONTIENE 'lograda' como subcadena, así
    // que una aserción por «contiene» pasaría con la lógica invertida y el defecto dentro.
    expect(cols.metaResultado).toBe('no_lograda');
    expect(comoNumero(cols.metaCostoPrometido)).toBe(43);
    expect(comoNumero(cols.metaCostoConseguido)).toBe(45);
    expect(cols.metaNota).toBe('ninguna maquila bajó de $18 con jareta');
  });

  it('🔴 EXIGE el número conseguido: sin él no hay brecha que enseñar', () => {
    expect(() => columnasDelDesenlace({ lograda: false, nota: 'no se consiguió' }, 43)).toThrow(
      ErrorValidacion,
    );
  });

  it('🔴 EXIGE el porqué: un costo peor sin explicación no le dice nada al que vendió', () => {
    expect(() => columnasDelDesenlace({ lograda: false, costoConseguido: 45 }, 43)).toThrow(
      ErrorValidacion,
    );
  });

  it('una nota EN BLANCO no es una nota (se recorta y se rechaza igual)', () => {
    expect(() =>
      columnasDelDesenlace({ lograda: false, costoConseguido: 45, nota: '   ' }, 43),
    ).toThrow(ErrorValidacion);
  });

  it('⭐ SIN meta encontrada se declara igual: se guarda lo que sí se sabe (REGLA 0-B)', () => {
    // La versión no vino de una mesa registrada. Eso NO puede impedir decir «no se consiguió»:
    // bloquearlo devolvería el incumplimiento al silencio, que es lo que la etapa vino a matar.
    const cols = columnasDelDesenlace(
      { lograda: false, costoConseguido: 45, nota: 'la tela negociada no existe en ese gramaje' },
      null,
    );
    expect(cols.metaResultado).toBe('no_lograda');
    expect(cols.metaCostoPrometido).toBeNull();
    expect(comoNumero(cols.metaCostoConseguido)).toBe(45);
  });
});

describe('columnasDelDesenlace — «SÍ se consiguió»', () => {
  it('⭐ NO exige ni el número ni la nota: no hay nada que explicar', () => {
    const cols = columnasDelDesenlace({ lograda: true }, 43);
    expect(cols.metaResultado).toBe('lograda');
    expect(comoNumero(cols.metaCostoPrometido)).toBe(43);
    expect(cols.metaCostoConseguido).toBeNull();
    expect(cols.metaNota).toBeNull();
  });

  it('pero los guarda si vienen (confirmar el número es información, no ruido)', () => {
    const cols = columnasDelDesenlace(
      { lograda: true, costoConseguido: 42, nota: 'salió $1 más barata' },
      43,
    );
    expect(cols.metaResultado).toBe('lograda');
    expect(comoNumero(cols.metaCostoConseguido)).toBe(42);
    expect(cols.metaNota).toBe('salió $1 más barata');
  });
});

describe('DESENLACE_BORRADO', () => {
  it('⭐ deja las CUATRO columnas en null — media tupla sería una brecha que nadie declaró', () => {
    // Es lo que escriben el rechazo, la invalidación y una firma que no contesta la pregunta. Si
    // alguna columna se quedara viva, el CHECK `modelos_meta_acto_completo_check` lo rebotaría en
    // la base; esta prueba lo detiene un paso antes, donde se lee el porqué.
    expect(DESENLACE_BORRADO).toEqual({
      metaResultado: null,
      metaCostoPrometido: null,
      metaCostoConseguido: null,
      metaNota: null,
    });
  });
});

// ── 3. EL JOIN: lo que de verdad se le manda a Postgres ───────────────────────

describe('expedienteDeLaNegociacion — la SQL que resuelve la meta', () => {
  const sql = expedienteDeLaNegociacion(9);

  /**
   * 🔴🔴 **LA ASERCIÓN QUE SOSTIENE LA ETAPA.** `crearVersionDeModelo` no crea expediente y la mesa
   * pasa ANTES de que la versión exista (§Post-F9.144(a)) ⇒ anclando sólo en `d.id_modelo = m.id`
   * la meta sale `null` **siempre** por el camino normal, y todo lo demás quedaría en decorado.
   *
   * 🔴🔴 **Y NO BASTA CON EL PADRE INMEDIATO.** `mintearVersionDeModelo` escribe el padre INMEDIATO,
   * y nada impide versionar una versión: para un `-02` nacido de un `-01`, el expediente está en la
   * RAÍZ, dos escalones arriba. Por eso el ancla es el conjunto de ANCESTROS, y por eso esta prueba
   * exige el join contra el linaje —no un `OR` de un nivel—.
   */
  it('⭐⭐ se ancla en los ANCESTROS, no en el padre inmediato (el linaje es una CADENA)', () => {
    expect(sql.text).toContain('d."id_modelo" = ln."id_ancestro"');
    expect(sql.text).toContain('ln."id_version" = m."id"');
    // 🔴 Y en NEGATIVO: el ancla de un solo nivel se fue. Sin esto, dejar el `OR` viejo al lado del
    // linaje pasaría las dos aserciones de arriba con el defecto todavía dentro.
    expect(sql.text).not.toContain('m."id_modelo_padre"');
  });

  it('⭐ prefiere el expediente que SÍ tiene mesa, y luego el MÁS CERCANO en el linaje', () => {
    // El orden es la resolución ESCRITA de la ambigüedad (un modelo puede tener expediente en
    // varios proyectos). Sin él, la fila enseñaría una meta cualquiera de las que hubiera.
    // `nivel ASC` = lo más específico gana: el propio antes que el del padre, y el del padre antes
    // que el del abuelo.
    const orden = sql.text.slice(sql.text.lastIndexOf('ORDER BY'));
    expect(orden).toContain('mesa."costo_estimado" IS NOT NULL) DESC');
    expect(orden).toContain('ln."nivel" ASC');
  });

  it('llega hasta el evento de negociación y toma el ÚLTIMO cierre de mesa', () => {
    expect(sql.text).toContain('"negociacion_evento"');
    expect(sql.text).toContain('ne."costo_estimado" IS NOT NULL');
  });

  it('⭐ acota el expediente a la empresa activa (A9) con el id que se le pasó', () => {
    expect(sql.values).toContain(9);
    expect(sql.text).toContain('p."id_empresa"');
  });

  it('sigue siendo LEFT JOIN: una versión sin expediente NO se cae de la bandeja', () => {
    // Con un JOIN normal, las versiones creadas a mano —que hay que revisar igual— desaparecerían.
    expect(sql.text.trimStart().startsWith('LEFT JOIN LATERAL')).toBe(true);
  });
});

describe('resolverCostoPrometido', () => {
  /**
   * `$queryRaw` de mentiras que **NO puede pasar por construcción**: sólo entrega la meta si la SQL
   * que recibió lleva de verdad el id del modelo, el de la empresa y el trozo del join que mira al
   * padre. Un doble que ignorara su argumento —el defecto que un reviewer demostró hoy— dejaría
   * esta prueba verde con el cableado roto.
   */
  function txConMesa(costo: number | null): Tx {
    return {
      $queryRaw: (sql: Prisma.Sql) => {
        if (!sql.values.includes(42)) {
          throw new Error('la consulta no lleva el id del modelo');
        }
        if (!sql.values.includes(9)) {
          throw new Error('la consulta no lleva el id de la empresa (A9)');
        }
        if (!sql.text.includes('d."id_modelo" = ln."id_ancestro"')) {
          throw new Error('la consulta no se ancla en los ancestros del linaje');
        }
        if (!sql.text.includes('WITH RECURSIVE "linaje"')) {
          throw new Error('la consulta no lleva la CTE del linaje que el LATERAL necesita');
        }
        return Promise.resolve(
          costo === null ? [] : [{ costoPrometido: new Prisma.Decimal(costo) }],
        );
      },
    } as unknown as Tx;
  }

  it('⭐ devuelve la meta con la que se cerró la mesa, como número', async () => {
    await expect(resolverCostoPrometido(txConMesa(43.5), 42, 9)).resolves.toBe(43.5);
  });

  it('⭐ null cuando no hay ninguna mesa (y eso NO es un error)', async () => {
    await expect(resolverCostoPrometido(txConMesa(null), 42, 9)).resolves.toBeNull();
  });

  it('null cuando la fila existe pero la columna viene vacía', async () => {
    const tx = {
      $queryRaw: () => Promise.resolve([{ costoPrometido: null }]),
    } as unknown as Tx;
    await expect(resolverCostoPrometido(tx, 42, 9)).resolves.toBeNull();
  });
});

describe('consultarMetaPrometida — la meta que ve quien va a firmar', () => {
  /** `tx` que entrega la meta sólo si le preguntan por el modelo y la empresa correctos. */
  function txConMeta(costo: number): Tx {
    return {
      $queryRaw: (sql: Prisma.Sql) => {
        if (!sql.values.includes(42) || !sql.values.includes(7)) {
          throw new Error('la consulta no lleva el modelo y la empresa que se le pidieron');
        }
        return Promise.resolve([{ costoPrometido: new Prisma.Decimal(costo) }]);
      },
    } as unknown as Tx;
  }
  const sesion = (permisos: ('modelos.aprobar-receta' | 'consultas.ver-importes')[]) =>
    sesionDePrueba({ idEmpresaActiva: 7, permisos });

  it('⭐ la devuelve a quien puede firmar y ver importes', async () => {
    await expect(
      consultarMetaPrometida(sesion(['modelos.aprobar-receta', 'consultas.ver-importes']), 42, {
        tx: txConMeta(43),
      }),
    ).resolves.toEqual({ costoPrometido: 43 });
  });

  it('exige `modelos.aprobar-receta` (es la meta de quien FIRMA)', async () => {
    await expect(
      consultarMetaPrometida(sesion(['consultas.ver-importes']), 42, { tx: txConMeta(43) }),
    ).rejects.toThrow(ErrorPermiso);
  });

  it('⭐ y exige `consultas.ver-importes`: es un IMPORTE, y ése es el permiso que ya los gobierna', async () => {
    // La pareja, no uno solo. Sin esta segunda aserción, quitar la verificación del importe dejaría
    // la anterior en verde y un costo se enseñaría a quien el sistema decidió que no ve importes.
    await expect(
      consultarMetaPrometida(sesion(['modelos.aprobar-receta']), 42, { tx: txConMeta(43) }),
    ).rejects.toThrow(ErrorPermiso);
  });
});

/**
 * ⚠️⚠️ **LO QUE ESTE BLOQUE PROTEGE, Y LO QUE NO — no lo leas de más.**
 *
 * Aquí se pincha el **TEXTO** de la SQL: que sea `RECURSIVE`, que arranque en la versión misma, que
 * tenga exactamente dos ramas, que la recursiva trepe por `id_siguiente` y que lleve tope. Mata las
 * regresiones de FORMA —volver al padre inmediato, avanzar por el nodo equivocado, saltarse el
 * nivel 0, quitar el tope— y **sólo ésas**.
 *
 * 🔴 **La SEMÁNTICA —que la cadena de verdad SUBA— NO la sostiene este archivo.** Medido: cambiar
 * `WHERE l."nivel" < 100` por `… < 100 AND false` deja intactas la subcadena del tope, las dos ramas
 * y la auto-referencia, es **SQL válido**, neutra la recursión entera… y **este suite pasa 100 % en
 * verde**. Quien la mata es `meta-negociada.int.test.ts` (el join, el hijo de en medio, las dos del
 * NIETO). **Si algún día hay que elegir entre las dos, se conserva la de integración.**
 */
describe('CTE_LINAJE_DE_VERSIONES — la cadena de ancestros (guardián de TEXTO)', () => {
  const cte = CTE_LINAJE_DE_VERSIONES.text;

  it('⭐⭐ es RECURSIVA: sube por `id_modelo_padre` hasta la raíz, no un solo escalón', () => {
    // 🔴 Es la corrección entera del defecto: con un join de un nivel, un `-02` nacido de un `-01`
    // no encuentra el expediente —que vive en la RAÍZ— y su brecha sale en blanco.
    expect(cte).toContain('WITH RECURSIVE "linaje"');
    expect(cte).toContain('JOIN "modelos" a ON a."id" = l."id_siguiente"');
    expect(cte).toContain('UNION ALL');
  });

  it('⭐ arranca en la VERSIÓN misma (nivel 0), para que su propio expediente siga ganando', () => {
    expect(cte).toContain('v."id"              AS "id_ancestro"');
    expect(cte).toContain('0                   AS "nivel"');
  });

  it('⭐ el término base filtra con el MISMO predicado de «¿es una versión?»', () => {
    // Sin este filtro la CTE recorrería los ~4,987 modelos migrados del Access para nada; y si
    // dejara entrar a los hijos del linaje 1:N, pediría expediente a quien no lleva revisión.
    expect(cte).toContain('v."id_modelo_desarrollo" IS NULL');
    expect(cte).toContain('v."id_modelo_padre" IS NOT NULL OR v."version_desarrollo" IS NOT NULL');
  });

  it('⭐ la recursión es la ÚNICA rama que sube, y su término es el que TREPA', () => {
    // `toHaveLength(2)` = término base + término recursivo, ni uno más: una rama extra sería otra
    // definición de «ancestro» conviviendo con ésta.
    const ramas = cte.split('UNION ALL');
    expect(ramas).toHaveLength(2);
    // Y el término recursivo se referencia a sí mismo y avanza POR `id_siguiente` (el padre). Si
    // avanzara por `id_ancestro` se quedaría girando en el mismo nodo hasta agotar el tope.
    expect(ramas[1]).toContain('FROM "linaje" l');
    expect(ramas[1]).toContain('a."id" = l."id_siguiente"');
  });

  it('🔒 lleva TOPE de profundidad: un ciclo en los datos colgaría la consulta para siempre', () => {
    expect(cte).toContain('l."nivel" < 100');
  });

  it('no lleva parámetros: es la misma CTE para toda consulta (no está correlada)', () => {
    // Postgres NO admite referencias LATERAL dentro de un WITH; por eso el cierre se calcula para
    // todas las versiones de una vez y el LATERAL lo consulta por `id_version`.
    expect(CTE_LINAJE_DE_VERSIONES.values).toEqual([]);
  });
});
