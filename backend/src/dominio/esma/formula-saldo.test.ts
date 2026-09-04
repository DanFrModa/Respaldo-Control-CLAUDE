/**
 * LA FÓRMULA DEL SALDO, ANTES DE TOCAR LA BASE DE DATOS (V1, fila 0.115).
 *
 * Estas pruebas son puras: no miden lo que devuelve una consulta, miden que **las dos formas del
 * criterio no se puedan separar**. El defecto que arreglamos no fue "un filtro mal escrito", fue
 * "la misma fórmula escrita tres veces y sólo una respetaba el estado de revisión". Por eso lo que
 * hay que blindar es el MECANISMO:
 *
 *  (1) el fragmento SQL de cada concepto sale del MISMO objeto que la cláusula de Prisma (mismas
 *      condiciones, mismos valores, mismas columnas) — si alguien agrega una condición a un lado y
 *      no al otro, esto se pone rojo;
 *  (2) los predicados de un renglón suelto (los que marcan «pendiente» en el detalle) dicen lo
 *      mismo que la cláusula de la suma;
 *  (3) los tres archivos que suman saldo NO vuelven a escribir el criterio a mano.
 *
 * La comprobación de que las TRES implementaciones dan el MISMO número contra datos reales vive en
 * `saldo-fuente-unica.int.test.ts` (necesita Postgres).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  aporteCargoAlSaldo,
  armarPendiente,
  CONCEPTOS_SALDO,
  columnaSegura,
  cuentaAlSaldoCargo,
  cuentaAlSaldoPlano,
  hayPendiente,
  netoPendiente,
  pendienteDeRevisionCargo,
  pendienteDeRevisionPlano,
  saldoDeTotales,
  SIGNO_SALDO,
  sqlCuenta,
  sqlPendiente,
  tieneSaldo,
  WHERE_CUENTA_ABONO,
  WHERE_CUENTA_CARGO,
  WHERE_CUENTA_DESCUENTO,
  WHERE_CUENTA_PAGO,
  WHERE_PENDIENTE_ABONO,
  WHERE_PENDIENTE_DESCUENTO,
  WHERE_PENDIENTE_PAGO,
  type ConceptoSaldo,
} from './formula-saldo.js';

/** Las cláusulas de Prisma por concepto, tal como las consume `saldos.ts`. */
const WHERE_CUENTA: Record<ConceptoSaldo, Record<string, unknown>> = {
  cargo: WHERE_CUENTA_CARGO,
  abono: WHERE_CUENTA_ABONO,
  pago: WHERE_CUENTA_PAGO,
  descuento: WHERE_CUENTA_DESCUENTO,
};

/** Las cláusulas de «pendiente» que existen en forma de Prisma (el cargo no tiene importe aún). */
const WHERE_PENDIENTE: Record<string, Record<string, unknown>> = {
  abono: WHERE_PENDIENTE_ABONO,
  pago: WHERE_PENDIENTE_PAGO,
  descuento: WHERE_PENDIENTE_DESCUENTO,
};

/** `camelCase` → `snake_case`, la convención de columnas del esquema (`@map`). */
function aColumna(campo: string): string {
  return campo.replace(/[A-Z]/g, (letra) => `_${letra.toLowerCase()}`);
}

/** Cómo se ve un valor del criterio literalizado en SQL. */
function comoLiteral(valor: unknown): string {
  return typeof valor === 'boolean' ? (valor ? 'TRUE' : 'FALSE') : `'${String(valor)}'`;
}

/**
 * Traduce una cláusula de Prisma a las condiciones SQL que DEBERÍA producir, sin mirar el generador:
 * la columna se deduce del nombre del campo y el valor se literaliza aparte. Así la prueba es una
 * segunda opinión, no un eco de la implementación.
 *
 * ⚠️ `null` se traduce a `IS NULL`, **nunca** a `= NULL` (V1, fila 0.109 — el criterio «vivo» del
 * descuento). `= NULL` no es falso en SQL: es DESCONOCIDO, y se comería la fila entera en silencio.
 * Esta segunda opinión lo sabe por su cuenta: si el generador emitiera `= 'null'`, la prueba lo caza.
 */
function condicionesEsperadas(where: Record<string, unknown>): string[] {
  return Object.entries(where).map(([campo, valor]) =>
    valor === null
      ? `"${aColumna(campo)}" IS NULL`
      : `"${aColumna(campo)}" = ${comoLiteral(valor)}`,
  );
}

/**
 * Parte un fragmento `(A AND B)` en sus condiciones, quitando los paréntesis que lo aíslan (el
 * generador los pone SIEMPRE para que un `OR` del que llama no se coma la segunda condición).
 */
function condicionesDe(sql: string): string[] {
  const desnudo = sql.trim().replace(/^\((.*)\)$/s, '$1');
  return desnudo.split(' AND ').map((c) => c.trim());
}

describe('formula-saldo · el SQL y el Prisma salen del MISMO criterio', () => {
  it.each([...CONCEPTOS_SALDO])(
    'el fragmento de "%s" que cuenta al saldo dice exactamente lo mismo que su cláusula de Prisma',
    (concepto) => {
      const esperadas = condicionesEsperadas(WHERE_CUENTA[concepto]);
      const emitidas = condicionesDe(sqlCuenta(concepto).sql);
      // Sin placeholders: el criterio son constantes del dominio, no entrada del usuario.
      expect(sqlCuenta(concepto).values).toEqual([]);
      // Mismo número de condiciones (una de menos en SQL = un saldo más laxo que el de Prisma).
      expect(emitidas).toHaveLength(esperadas.length);
      expect([...emitidas].sort()).toEqual([...esperadas].sort());
    },
  );

  it.each(Object.keys(WHERE_PENDIENTE))(
    'el fragmento de "%s" pendiente dice exactamente lo mismo que su cláusula de Prisma',
    (concepto) => {
      const esperadas = condicionesEsperadas(WHERE_PENDIENTE[concepto] ?? {});
      const emitidas = condicionesDe(sqlPendiente(concepto as ConceptoSaldo).sql);
      expect(emitidas).toHaveLength(esperadas.length);
      expect([...emitidas].sort()).toEqual([...esperadas].sort());
    },
  );

  it('lo que cuenta y lo que está pendiente son criterios DISTINTOS en los cuatro conceptos', () => {
    // Si alguien "arregla" el pendiente copiándole el criterio al que cuenta, el dinero excluido
    // volvería a sumar por la puerta de atrás.
    for (const concepto of CONCEPTOS_SALDO) {
      expect(sqlPendiente(concepto).sql).not.toBe(sqlCuenta(concepto).sql);
    }
  });

  it('abono y pago comparten criterio; el DESCUENTO lleva UNA condición más: estar VIVO', () => {
    // Hasta la fila 0.109 los TRES planos compartían criterio y esta prueba lo exigía. Ya no, y el
    // cambio es de negocio, no de forma: el descuento es el único que puede NACER DE UN ACTO
    // REVERSIBLE —el cierre de una orden con un maquilero, que propone cobrarle el faltante y que se
    // puede DESHACER— y por eso es el único que se cancela. La condición `cancelado_en IS NULL` va
    // en los DOS criterios: un descuento cancelado ni suma al saldo ni sigue esperando revisión.
    expect(sqlCuenta('abono').sql).toBe(sqlCuenta('pago').sql);
    expect(sqlPendiente('abono').sql).toBe(sqlPendiente('pago').sql);

    // El descuento = lo mismo que sus hermanos MÁS la condición de vivo (en los dos criterios).
    for (const fragmento of [sqlCuenta('descuento').sql, sqlPendiente('descuento').sql]) {
      expect(condicionesDe(fragmento)).toContain('"cancelado_en" IS NULL');
    }
    expect(condicionesDe(sqlCuenta('descuento').sql).sort()).toEqual(
      [...condicionesDe(sqlCuenta('abono').sql), '"cancelado_en" IS NULL'].sort(),
    );
    expect(condicionesDe(sqlPendiente('descuento').sql).sort()).toEqual(
      [...condicionesDe(sqlPendiente('abono').sql), '"cancelado_en" IS NULL'].sort(),
    );
  });

  it('lo que entra CRUDO al SQL se valida: columnas y valores', () => {
    // Los dos lados de `"col" = valor` pasan por un filtro antes de `Prisma.raw`. Hoy salen de este
    // archivo, pero un `raw` sin validar es una puerta que no se deja entornada.
    expect(columnaSegura('estado_revision')).toBe('estado_revision');
    expect(columnaSegura('sin_costo')).toBe('sin_costo');
    for (const mala of ['estado"; DROP TABLE x --', 'Estado', '1_cosa', 'con espacio', '']) {
      expect(() => columnaSegura(mala), mala).toThrow(/Columna no literalizable/);
    }
  });

  it.each([...CONCEPTOS_SALDO])(
    'el fragmento de "%s" va ENTRE PARÉNTESIS (un OR no puede comerse una condición)',
    (concepto) => {
      // Sin paréntesis, `... OR ${sqlCuenta('cargo')}` se leería como `(… OR estado='validado') AND
      // sin_costo=FALSE`: el cargo perdería su segunda condición EN SILENCIO y el saldo le cobraría
      // al maquilero las segundas sin costo. El aislamiento no puede depender de quién llame.
      for (const fragmento of [sqlCuenta(concepto).sql, sqlPendiente(concepto).sql]) {
        expect(fragmento.startsWith('('), fragmento).toBe(true);
        expect(fragmento.endsWith(')'), fragmento).toBe(true);
      }
    },
  );

  it('el cargo exige SUS DOS condiciones (revisado y con costo)', () => {
    // Perder `sin_costo = FALSE` le cobraría al maquilero las segundas que no se le pagan.
    expect(condicionesDe(sqlCuenta('cargo').sql)).toHaveLength(2);
    expect(sqlCuenta('cargo').sql).toContain('"sin_costo" = FALSE');
  });
});

describe('formula-saldo · el renglón suelto dice lo mismo que la suma', () => {
  it('un movimiento plano cuenta si —y sólo si— su estado es el de la cláusula que suma', () => {
    const estadoQueCuenta = WHERE_CUENTA_ABONO.estadoRevision;
    const estadoPendiente = WHERE_PENDIENTE_ABONO.estadoRevision;
    expect(estadoQueCuenta).not.toBe(estadoPendiente);

    expect(cuentaAlSaldoPlano('revisado')).toBe(true);
    expect(cuentaAlSaldoPlano('capturado')).toBe(false);
    expect(pendienteDeRevisionPlano('capturado')).toBe(true);
    expect(pendienteDeRevisionPlano('revisado')).toBe(false);
    // Y coinciden con la cláusula, sea cual sea el valor que se elija mañana.
    expect(cuentaAlSaldoPlano(estadoQueCuenta as 'revisado')).toBe(true);
    expect(pendienteDeRevisionPlano(estadoPendiente as 'capturado')).toBe(true);
  });

  it('un cargo cuenta sólo validado y con costo; propuesto está pendiente', () => {
    expect(cuentaAlSaldoCargo({ estado: 'validado', sinCosto: false })).toBe(true);
    expect(cuentaAlSaldoCargo({ estado: 'validado', sinCosto: true })).toBe(false);
    expect(cuentaAlSaldoCargo({ estado: 'propuesto', sinCosto: false })).toBe(false);
    expect(cuentaAlSaldoCargo({ estado: 'cancelado', sinCosto: false })).toBe(false);
    expect(pendienteDeRevisionCargo({ estado: 'propuesto' })).toBe(true);
    expect(pendienteDeRevisionCargo({ estado: 'validado' })).toBe(false);
    expect(pendienteDeRevisionCargo({ estado: 'cancelado' })).toBe(false);
  });

  it('el aporte de un cargo al detalle: importe si cuenta, 0 si es sin costo validado, null si no se sabe', () => {
    expect(aporteCargoAlSaldo({ estado: 'validado', sinCosto: false }, 80)).toBe(80);
    expect(aporteCargoAlSaldo({ estado: 'validado', sinCosto: false }, null)).toBeNull();
    expect(aporteCargoAlSaldo({ estado: 'validado', sinCosto: true }, 80)).toBe(0);
    expect(aporteCargoAlSaldo({ estado: 'propuesto', sinCosto: false }, 80)).toBeNull();
    expect(aporteCargoAlSaldo({ estado: 'cancelado', sinCosto: false }, 80)).toBeNull();
  });
});

describe('formula-saldo · signos y redondeo', () => {
  it('cargo y abono suman; pago y descuento restan', () => {
    expect(SIGNO_SALDO.cargo).toBe(1);
    expect(SIGNO_SALDO.abono).toBe(1);
    expect(SIGNO_SALDO.pago).toBe(-1);
    expect(SIGNO_SALDO.descuento).toBe(-1);
  });

  it('el saldo aplica esos signos a los cuatro totales', () => {
    expect(
      saldoDeTotales({ totalCargos: 80, totalAbonos: 15, totalPagos: 48, totalDescuentos: 5 }),
    ).toBe(42);
    // Cada signo, aislado: si uno se voltea, el número cambia.
    expect(
      saldoDeTotales({ totalCargos: 0, totalAbonos: 10, totalPagos: 0, totalDescuentos: 0 }),
    ).toBe(10);
    expect(
      saldoDeTotales({ totalCargos: 0, totalAbonos: 0, totalPagos: 10, totalDescuentos: 0 }),
    ).toBe(-10);
    expect(
      saldoDeTotales({ totalCargos: 0, totalAbonos: 0, totalPagos: 0, totalDescuentos: 10 }),
    ).toBe(-10);
  });

  it('«tiene saldo» tolera medio centavo, y ES la mitad del corte de las dos bandejas', () => {
    // El corte de una fila (tablero de EsMa y bandeja de CxP) es `tieneSaldo(saldo) ||
    // hayPendiente(pendiente)`. Estaba escrito TRES veces, y dos de ellas ni siquiera decían lo
    // mismo (`saldo !== 0` en una, `Math.abs(saldo) >= 0.005` en las otras).
    expect(tieneSaldo(0)).toBe(false);
    expect(tieneSaldo(-0)).toBe(false);
    expect(tieneSaldo(0.004)).toBe(false);
    expect(tieneSaldo(-0.004)).toBe(false);
    // Medio centavo YA es saldo (redondearía a un centavo), y el signo no cambia la respuesta.
    expect(tieneSaldo(0.005)).toBe(true);
    expect(tieneSaldo(-0.005)).toBe(true);
    expect(tieneSaldo(800)).toBe(true);
    expect(tieneSaldo(-800)).toBe(true);
    // Y la basura de coma flotante NO cuenta como deuda (lo que `saldo !== 0` sí dejaba pasar).
    expect(tieneSaldo(0.1 + 0.2 - 0.3)).toBe(false);
  });

  it('el neto pendiente usa los MISMOS signos que el saldo', () => {
    expect(netoPendiente({ abonos: 100, pagos: 30, descuentos: 20 })).toBe(50);
    expect(netoPendiente({ abonos: 0, pagos: 40, descuentos: 0 })).toBe(-40);
    expect(netoPendiente({ abonos: 0, pagos: 0, descuentos: 25 })).toBe(-25);
    expect(netoPendiente({ abonos: 0, pagos: 0, descuentos: 0 })).toBe(0);
  });

  it('«hay pendiente» se decide por el CONTEO de partidas, no por los importes', () => {
    // (a) Un abono y un pago capturados del mismo importe netean 0: con el neto, ese maquilero
    // desaparecería teniendo DOS partidas esperando decisión.
    const neteanCero = armarPendiente(30, 30, 0, 2);
    expect(neteanCero.neto).toBe(0);
    expect(hayPendiente(neteanCero)).toBe(true);

    // (b) Y los SUBTOTALES tampoco alcanzan: el ETL carga montos negativos a propósito ("saldo
    // anterior" del Access), así que +500 y −500 dejan el subtotal de abonos en 0 con dos partidas.
    const seCancelanEntreSi = armarPendiente(0, 0, 0, 2);
    expect(seCancelanEntreSi.abonos).toBe(0);
    expect(seCancelanEntreSi.pagos).toBe(0);
    expect(seCancelanEntreSi.descuentos).toBe(0);
    expect(hayPendiente(seCancelanEntreSi)).toBe(true);

    // Y cuando de verdad no hay nada, dice que no.
    expect(hayPendiente(armarPendiente(0, 0, 0, 0))).toBe(false);
  });

  it('el bloque de pendiente redondea cada importe a 2 decimales y luego el neto', () => {
    const p = armarPendiente(10.005, 0.001, 0, 3);
    expect(p.abonos).toBe(10.01);
    expect(p.pagos).toBe(0);
    expect(p.descuentos).toBe(0);
    expect(p.neto).toBe(10.01);
    expect(p.partidas).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ LA GUARDIA: QUE NO SE PUEDA ESCRIBIR UNA QUINTA SUMA CON OTRO CRITERIO
//
// Esto es el criterio de aceptación de la fila 0.115, y por eso se prueba en DOS capas:
//
//  (1) los DETECTORES contra código sintético — se les enseña una "quinta copia" escrita a mano (en
//      sus tres formas: `aggregate` de Prisma, SQL crudo y `findMany` + `reduce`) y tienen que
//      señalarla. Sin esta capa, un detector roto pasaría inadvertido mientras el árbol esté limpio;
//  (2) los detectores contra el ÁRBOL REAL — ningún archivo de `src`/`migracion` puede sumar sobre
//      las cuatro tablas de EsMa sin pedirle el criterio a `formula-saldo.ts`.
//
// Un barrido a secas de los literales NO sirve y ya se descartó: hay ~10 archivos legítimos que los
// escriben como ESCRITORES (`movimientos.ts` pone 'revisado' al revisar, `cargos.ts` pone 'validado'
// al validar). Por eso se exige la combinación "agrega sobre esas tablas" + ("no importa la fórmula"
// O "la importa pero igual escribe una condición a mano" — importarla no es coartada). La decisión
// vive en UNA función (`motivoDeInfraccion`) que corre igual contra código sintético y contra el repo.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** Los cuatro modelos Prisma y las cuatro tablas físicas donde vive el dinero de EsMa. */
const MODELOS = '(?:esMaCargo|abonoMaquilero|pagoMaquilero|descuentoMaquilero)';
const TABLAS = '(?:esma_cargo|abono_maquilero|pago_maquilero|descuento_maquilero)';

/**
 * ¿Este código AGREGA dinero sobre las tablas de EsMa? Tres formas, que son las tres maneras reales
 * de escribir una suma en este proyecto:
 *  • `modelo.aggregate(` / `.groupBy(` (Prisma),
 *  • un `FROM`/`JOIN` sobre la tabla dentro de un `$queryRaw` (SQL crudo),
 *  • `modelo.findMany(` + un `.reduce(` en el mismo archivo (la suma a mano).
 *
 * ⚠️ El detector de SQL crudo mira `FROM` **y `JOIN`**, con las comillas OPCIONALES y aceptando el
 * ESQUEMA por delante (`public."abono_maquilero"`). No es cosmética: un reviewer atravesó la versión
 * anterior —que sólo reconocía `FROM "tabla"`— con dos quintas copias triviales, una que alcanzaba la
 * tabla por `JOIN "abono_maquilero"` y otra con `FROM pago_maquilero` sin comillas; las dos escribían
 * el criterio a mano y la suite pasaba en verde. Y el `JOIN` no es rebuscado: es la forma NATURAL de
 * escribir el agregado (`saldos-todos.ts` sólo se salva porque mete cada tabla en su propia
 * subconsulta, con su `FROM`). El `\b` va pegado al nombre de la tabla —no después de la comilla de
 * cierre— porque tras un `"` seguido de espacio no hay frontera de palabra.
 *
 * 🔎 LÍMITES CONOCIDOS, dichos a propósito en vez de callados: NO reconoce la tabla cuando llega en
 * una lista por comas (`FROM "a" x, "abono_maquilero" y`) ni con un comentario SQL intercalado entre
 * el `FROM` y el nombre. Ninguna de las dos es el estilo de la casa —el proyecto escribe `JOIN`
 * explícito y sin comentarios dentro del `Prisma.sql`—, y perseguirlas con una expresión regular
 * empieza a pedir un parser de SQL. Si algún día aparecen, la respuesta es esa lista de arriba: se
 * amplía el patrón con su forma concreta y se le agrega su caso sintético.
 */
function agregaDineroEsMa(codigo: string): boolean {
  const prisma = new RegExp(`${MODELOS}\\.(?:aggregate|groupBy)\\(`).test(codigo);
  const sqlCrudo = new RegExp(`(?:FROM|JOIN)\\s+(?:"?[a-z_]+"?\\.)?"?${TABLAS}\\b`, 'i').test(
    codigo,
  );
  const aMano = new RegExp(`${MODELOS}\\.findMany\\(`).test(codigo) && /\.reduce\(/.test(codigo);
  return prisma || sqlCrudo || aMano;
}

/** ¿Le pide el criterio a la definición única? */
function usaLaFormula(codigo: string): boolean {
  return codigo.includes('formula-saldo.js');
}

/**
 * El criterio EN POSICIÓN DE FILTRO, escrito a mano. Son expresiones, no subcadenas sueltas, porque
 * los mismos valores aparecen legítimamente en otros sitios y una guardia con falsos positivos se
 * acaba desactivando:
 *  • `estadoRevision: true` en un `select` NO es un filtro (por eso se exige el valor entre comillas);
 *  • `estadoRevision: 'capturado' | 'revisado'` es un TIPO (por eso se descarta lo seguido de `|`);
 *  • `sinCosto: true` en un `select` tampoco (el criterio del saldo es `false`);
 *  • `estado: { not: 'cancelado' }` es otro filtro, no el del saldo.
 */
const MARCAS_CRITERIO: [nombre: string, patron: RegExp][] = [
  [
    "estadoRevision: 'revisado' | 'capturado'",
    /estadoRevision:\s*'(?:revisado|capturado)'(?!\s*\|)/,
  ],
  ["estado: 'validado' | 'propuesto'", /estado:\s*'(?:validado|propuesto)'/],
  ['sinCosto: false', /sinCosto:\s*false/],
  // Las dos columnas snake_case van con las COMILLAS OPCIONALES (mismo motivo que el detector de
  // `FROM`/`JOIN`): en SQL crudo `estado_revision IN (…)` filtra igual que `"estado_revision" IN (…)`.
  // Se puede hacer sin miedo a falsos positivos porque ningún archivo de producción menciona esos dos
  // nombres físicos fuera de la propia definición (`formula-saldo.ts`, que la guardia no escanea).
  ['estado_revision = …', /"?estado_revision"?\s*(?:=|IN)/i],
  ['sin_costo = …', /"?sin_costo"?\s*=/i],
  // `estado`, en cambio, se exige ENTRECOMILLADO: a secas es una palabra demasiado común (otros
  // módulos filtran su propio `estado` en SQL crudo) y la guardia perdería su utilidad a base de
  // falsos positivos. La evasión que eso dejaría abierta —`FROM esma_cargo WHERE estado = 'validado'`—
  // la caza igual la marca de `sin_costo`, que ese mismo criterio necesita.
  ['"estado" = \'…\'', /"estado"\s*(?:=|IN)\s*[(']/],
];

/** ¿Escribe a mano alguna condición del criterio? Devuelve cuáles (para que el fallo se lea). */
function escribeElCriterioAMano(codigo: string): string[] {
  return MARCAS_CRITERIO.filter(([, patron]) => patron.test(codigo)).map(([nombre]) => nombre);
}

/**
 * ⭐ LA DECISIÓN DE LA GUARDIA, en un solo lugar: la usan la capa sintética y la del árbol real, para
 * que lo que se prueba contra código inventado sea EXACTAMENTE lo que corre contra el repo. Un archivo
 * es infractor si AGREGA dinero de EsMa y (a) no le pide el criterio a la fórmula, o (b) se lo pide
 * PERO igual escribe alguna condición a mano. Devuelve el motivo, o `null` si está limpio.
 *
 * ⚠️ QUÉ GARANTIZA Y QUÉ NO — para que nadie le pida más de lo que puede dar. Garantiza que **nadie
 * REESCRIBA el criterio**: quien sume sobre estas tablas tiene que pedírselo a `formula-saldo.ts`, y
 * si además escribe una condición a mano se le caza. NO garantiza que todo el que sume lo **APLIQUE**:
 * basta con importar la fórmula y no escribir literales para pasar, aunque la consulta no filtre por
 * estado de revisión. Y está bien que así sea, porque ese caso EXISTE a propósito: `migracion/
 * cuadre-f6.ts` importa `sqlCuenta` para el cargo pero suma los movimientos planos SIN filtrar por
 * revisión —compara contra un Access que no conocía el concepto—. Distinguir "suma con el criterio
 * correcto" de "suma sin ningún criterio" pediría entender el SQL, no leerlo; la guardia se queda en
 * lo que puede afirmar sin mentir.
 */
function motivoDeInfraccion(codigo: string): string | null {
  if (!agregaDineroEsMa(codigo)) return null;
  if (!usaLaFormula(codigo)) return 'suma dinero de EsMa sin importar formula-saldo.ts';
  const aMano = escribeElCriterioAMano(codigo);
  return aMano.length === 0
    ? null
    : `importa formula-saldo.ts pero escribe el criterio a mano: ${aMano.join(' · ')}`;
}

/** Quita comentarios para no confundir una explicación con una condición viva. */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linea) => !linea.trim().startsWith('//') && !linea.trim().startsWith('*'))
    .join('\n');
}

/** Raíz del backend, desde `src/dominio/esma/` → `src` → `dominio` → … */
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Todos los `.ts` de producción de TODO el backend (`src` entero + `migracion`), sin pruebas ni la
 * propia definición. Se barre `src` completo y no sólo `dominio` a propósito: una quinta suma en una
 * ruta del API o en un script también sería una quinta suma (aunque A1 la prohíba ahí).
 */
function archivosDeProduccion(): string[] {
  const salida: string[] = [];
  for (const carpeta of ['src', 'migracion']) {
    const raiz = join(RAIZ, carpeta);
    for (const entrada of readdirSync(raiz, { recursive: true, withFileTypes: true })) {
      if (!entrada.isFile() || !entrada.name.endsWith('.ts')) continue;
      if (entrada.name.endsWith('.test.ts') || entrada.name === 'formula-saldo.ts') continue;
      if (entrada.parentPath.includes('node_modules') || entrada.parentPath.includes('generated')) {
        continue;
      }
      salida.push(join(entrada.parentPath, entrada.name));
    }
  }
  return salida.sort();
}

/**
 * Archivos que TOCAN esas tablas y agregan, pero NO son el saldo. Cada uno con su razón: la lista es
 * corta y explícita a propósito — un archivo NUEVO no está aquí, así que la guardia lo caza y quien
 * lo escriba tiene que decidir conscientemente si usa la fórmula o justifica por qué no.
 */
const NO_SON_EL_SALDO: Record<string, string> = {
  'src/dominio/esma/cargos.ts': 'cola de validación de cargos: cuenta y lista, no deriva el saldo',
  'src/dominio/esma/conciliacion.ts': 'cuadra recibido (F3) contra cargado (EsMa), no el saldo',
  'src/dominio/esma/movimientos.ts':
    'alta y revisión de partidas; el total que suma es el de SU lista',
  'src/dominio/esma/pagos.ts': 'aplica pagos a cargos (agrega PagoAplicacion, no la cuenta)',
  'src/dominio/esma/semanales.ts': 'corte de caja de la semana: pagos capturados, otra pregunta',
};

/**
 * Los archivos que SÍ derivan el saldo, su detalle, o razonan sobre el MISMO conjunto de renglones:
 * ahí no puede quedar ni un criterio a mano. Se comprueban por NOMBRE —no por si `agregaDineroEsMa`
 * los detecta— porque el detector es de texto y no ve todas las formas de recorrer una consulta:
 * `orden-pagada.ts` lee sus cargos con `findMany` + un `for` (sin `.reduce(`) y se le escapaba, y su
 * criterio es justamente el del saldo (los cargos «pagables» son los que le cuentan al maquilero).
 */
const CONSUMIDORES_DEL_SALDO = [
  'src/dominio/esma/saldos.ts',
  'src/dominio/esma/saldos-todos.ts',
  'src/dominio/esma/estado-cuenta.ts',
  'src/dominio/esma/orden-pagada.ts',
  'src/dominio/terceros/convivencia-esma.ts',
];

describe('⭐ guardia (1/2) · los detectores reconocen una quinta copia sintética', () => {
  // Es, letra por letra, lo que un reviewer escribió para demostrar que la guardia anterior no
  // servía: una quinta suma con su propio criterio, en un archivo nuevo.
  const quintaCopiaSql = `
    const filas = await cliente.$queryRaw(Prisma.sql\`
      SELECT SUM("monto") AS total FROM "abono_maquilero"
      WHERE "id_empresa" = 1 AND "estado_revision" IN ('revisado','capturado')
    \`);`;
  const quintaCopiaPrisma = `
    const total = await cliente.abonoMaquilero.aggregate({
      where: { idEmpresa, estadoRevision: 'capturado' },
      _sum: { monto: true },
    });`;
  const quintaCopiaAMano = `
    const filas = await cliente.pagoMaquilero.findMany({ where: { estadoRevision: 'revisado' } });
    const total = filas.reduce((s, f) => s + f.monto.toNumber(), 0);`;
  // ⭐ Las DOS formas con las que un reviewer atravesó la guardia ANTERIOR (que sólo miraba
  // `FROM "tabla"`). No son rebuscadas: el JOIN es la manera natural de escribir el agregado, y las
  // comillas en Postgres son opcionales mientras el nombre venga en minúsculas.
  const quintaCopiaJoin = `
    const filas = await cliente.$queryRaw(Prisma.sql\`
      SELECT p."id", SUM(a."monto") AS "total"
      FROM "proveedores" p
      JOIN "abono_maquilero" a ON a."id_maquilero" = p."id"
      WHERE a."id_empresa" = 1 AND a."estado_revision" IN ('revisado','capturado')
      GROUP BY p."id"
    \`);`;
  const quintaCopiaSinComillas = `
    const filas = await cliente.$queryRaw(Prisma.sql\`
      SELECT SUM("monto") AS "total" FROM pago_maquilero
      WHERE "id_empresa" = 1 AND estado_revision IN ('revisado','capturado')
    \`);`;
  // Y las dos formas CALIFICADAS POR ESQUEMA: `public.tabla` y `"public"."tabla"`. Postgres las
  // acepta igual que el nombre pelón, así que para la guardia tienen que ser la misma suma.
  const quintaCopiaEsquema = `
    const filas = await cliente.$queryRaw(Prisma.sql\`
      SELECT SUM("monto") AS "total" FROM public."descuento_maquilero"
      WHERE "id_empresa" = 1 AND "estado_revision" IN ('revisado','capturado')
    \`);`;
  const quintaCopiaEsquemaEntrecomillado = `
    const filas = await cliente.$queryRaw(Prisma.sql\`
      SELECT SUM(a."monto") AS "total"
      FROM "proveedores" p
      JOIN "public"."abono_maquilero" a ON a."id_maquilero" = p."id"
      WHERE a."estado_revision" IN ('revisado','capturado')
    \`);`;

  it.each([
    ['SQL crudo', quintaCopiaSql],
    ['aggregate de Prisma', quintaCopiaPrisma],
    ['findMany + reduce', quintaCopiaAMano],
    ['SQL crudo que llega por un JOIN', quintaCopiaJoin],
    ['SQL crudo con la tabla SIN comillas', quintaCopiaSinComillas],
    ['SQL crudo con el esquema por delante (public."tabla")', quintaCopiaEsquema],
    [
      'SQL crudo con el esquema entrecomillado ("public"."tabla")',
      quintaCopiaEsquemaEntrecomillado,
    ],
  ])('detecta la suma escrita como %s', (_forma, codigo) => {
    expect(agregaDineroEsMa(codigo)).toBe(true);
    expect(usaLaFormula(codigo)).toBe(false);
    expect(escribeElCriterioAMano(codigo).length).toBeGreaterThan(0);
    expect(motivoDeInfraccion(codigo)).toContain('sin importar formula-saldo.ts');
  });

  it('⭐ tampoco se deja engañar por una copia que IMPORTA la fórmula y aun así escribe el criterio', () => {
    // La coartada obvia: traer la fórmula para una suma y escribir a mano la de al lado. Si la guardia
    // se conformara con ver el import, esto pasaría.
    const disfrazada = `
      import { WHERE_CUENTA_ABONO } from './formula-saldo.js';
      const revisados = await cliente.abonoMaquilero.aggregate({
        where: { ...base, ...WHERE_CUENTA_ABONO },
        _sum: { monto: true },
      });
      const capturados = await cliente.abonoMaquilero.aggregate({
        where: { ...base, estadoRevision: 'capturado' },
        _sum: { monto: true },
      });`;
    expect(motivoDeInfraccion(disfrazada)).toContain('escribe el criterio a mano');
    expect(motivoDeInfraccion(disfrazada)).toContain("estadoRevision: 'revisado' | 'capturado'");
  });

  it('no se alarma con código que NO toca el dinero de EsMa', () => {
    const inocente = `
      const filas = await cliente.movimientoTercero.aggregate({ _sum: { monto: true } });
      const total = filas._sum.monto ?? 0;`;
    expect(agregaDineroEsMa(inocente)).toBe(false);
    expect(motivoDeInfraccion(inocente)).toBeNull();
  });

  it('no se alarma con una suma que SÍ pide el criterio a la definición única', () => {
    const correcta = `
      import { WHERE_CUENTA_ABONO } from './formula-saldo.js';
      const total = await cliente.abonoMaquilero.aggregate({
        where: { ...base, ...WHERE_CUENTA_ABONO },
        _sum: { monto: true },
      });`;
    expect(agregaDineroEsMa(correcta)).toBe(true);
    expect(usaLaFormula(correcta)).toBe(true);
    expect(escribeElCriterioAMano(correcta)).toEqual([]);
    expect(motivoDeInfraccion(correcta)).toBeNull();
  });
});

describe('⭐ guardia (2/2) · el árbol real no tiene ninguna quinta suma', () => {
  it('toda suma sobre las tablas de EsMa pide su criterio a formula-saldo (o está declarada aparte)', () => {
    const infractores: string[] = [];
    for (const ruta of archivosDeProduccion()) {
      const relativa = relative(RAIZ, ruta).split(sep).join('/');
      if (relativa in NO_SON_EL_SALDO) continue;
      const motivo = motivoDeInfraccion(sinComentarios(readFileSync(ruta, 'utf8')));
      if (motivo !== null) infractores.push(`${relativa} → ${motivo}`);
    }
    expect(
      infractores,
      'Estos archivos suman dinero de EsMa con un criterio propio. O le piden TODO el criterio a ' +
        'formula-saldo.ts, o se declaran en NO_SON_EL_SALDO explicando por qué NO son el saldo.',
    ).toEqual([]);
  });

  it.each(CONSUMIDORES_DEL_SALDO)('%s no re-escribe ninguna condición del criterio', (relativa) => {
    const codigo = sinComentarios(readFileSync(join(RAIZ, relativa), 'utf8'));
    expect(usaLaFormula(codigo)).toBe(true);
    expect(
      escribeElCriterioAMano(codigo),
      `${relativa} debe pedirle el criterio a formula-saldo.ts, no escribirlo`,
    ).toEqual([]);
  });

  it('la lista de excepciones sigue apuntando a archivos que existen y siguen agregando', () => {
    // Si un archivo de la lista deja de agregar (o se borra), la excepción sobra y hay que quitarla:
    // una lista de excepciones que se pudre es como no tener guardia.
    for (const relativa of Object.keys(NO_SON_EL_SALDO)) {
      const codigo = sinComentarios(readFileSync(join(RAIZ, relativa), 'utf8'));
      expect(agregaDineroEsMa(codigo), `${relativa} ya no agrega: quita su excepción`).toBe(true);
    }
  });
});
