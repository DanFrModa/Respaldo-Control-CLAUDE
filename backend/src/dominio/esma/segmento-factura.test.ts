/**
 * ⭐ EL SEGMENTO CON / SIN FACTURA, UNA SOLA VEZ (fila 0.113).
 *
 * Estas pruebas no miden lo que devuelve una consulta: miden que **las dos formas del criterio no se
 * puedan separar** y que **nadie lo vuelva a escribir a mano**. Es el mismo mecanismo que blinda la
 * fórmula del saldo (`formula-saldo.test.ts`), aplicado al otro criterio que estaba escrito dos
 * veces con dos respuestas distintas:
 *
 *  • `esma/estado-cuenta.ts` y `esma/saldos.ts` decían «sin factura» = `conFactura = false`;
 *  • `terceros/convivencia-esma.ts` decía `false` **o** sin definir.
 *
 * Como `conFactura` es NULLABLE (así quedó lo migrado del Access), la diferencia NO era cosmética:
 * un movimiento sin definir no salía en NINGUNA de las dos relaciones semanales de Daniel
 * (§Post-F9.189(a): son dos corridas por semana) y nadie lo hubiera pagado nunca.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { sqlSegmentoFactura, whereSegmentoFactura } from './formula-saldo.js';

/** Raíz del backend, desde `src/dominio/esma/`. */
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));

describe('la definición única del segmento', () => {
  it('«con factura» es exactamente `conFactura = true`, en las dos formas', () => {
    expect(whereSegmentoFactura('con')).toEqual({ conFactura: true });
    expect(sqlSegmentoFactura('con').sql).toBe('("con_factura" = TRUE)');
  });

  it('⭐ «sin factura» incluye los SIN DEFINIR, en las dos formas', () => {
    // Es la mitad que importa: sin ella, lo migrado del Access no cae en ninguna relación.
    expect(whereSegmentoFactura('sin')).toEqual({
      OR: [{ conFactura: false }, { conFactura: null }],
    });
    const sql = sqlSegmentoFactura('sin').sql;
    expect(sql).toContain('"con_factura" = FALSE');
    expect(sql).toContain('"con_factura" IS NULL');
    expect(sql).toContain(' OR ');
  });

  it('sin segmento no filtra nada (y en SQL es neutro dentro de un AND)', () => {
    expect(whereSegmentoFactura(undefined)).toEqual({});
    expect(sqlSegmentoFactura(undefined).sql).toBe('(TRUE)');
  });

  it('⭐ el fragmento SQL SIEMPRE va entre paréntesis', () => {
    // El `OR` del segmento «sin» sin paréntesis se comería la condición de al lado en silencio:
    // `WHERE id_empresa = 1 AND con_factura = FALSE OR con_factura IS NULL` trae los NULL de TODAS
    // las empresas. No es teórico: así se intercala, dentro de un `AND`.
    for (const segmento of ['con', 'sin', undefined] as const) {
      const sql = sqlSegmentoFactura(segmento).sql;
      expect(sql.startsWith('(')).toBe(true);
      expect(sql.endsWith(')')).toBe(true);
    }
  });

  it('NO usa `{ not: true }`, que parece equivalente y no lo es', () => {
    // En lógica de tres valores `NULL <> true` evalúa a NULL y la fila se descarta igual que con
    // `= false`: las dos formas dejan fuera los NULL. La única que los trae es la explícita.
    const sin = whereSegmentoFactura('sin');
    expect(JSON.stringify(sin)).not.toContain('not');
  });
});

/**
 * Todos los `.ts` de producción de TODO el backend (`src` entero + `migracion`), sin pruebas ni la
 * propia definición. Mismo barrido que la guardia de la fórmula del saldo, y por el mismo motivo:
 *
 * 🔴 **Esta guardia era una LISTA FIJA de cuatro archivos y no servía.** El reviewer de 0.113
 * escribió una quinta copia del criterio (`{ conFactura: s === 'con' }` y un `AND "con_factura" =
 * FALSE` crudo) en un archivo NUEVO, y la suite pasó en verde — exactamente la reincidencia que la
 * fila 0.115 ya había rechazado en la fórmula del saldo. Una lista sólo vigila lo que alguien se
 * acordó de escribir en ella; el árbol vigila lo que hay.
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
 * ⭐ EL MARCADOR QUE EXIME **UNA LÍNEA**, no un archivo entero.
 *
 * 🔴 La versión anterior de esta guardia eximía por ARCHIVO, y eso dejaba un agujero exacto: bastaba
 * con que un archivo tuviera una línea legítima para que **todo el archivo** saliera del barrido, y
 * una quinta copia escrita 200 líneas más abajo pasaba en verde. La excepción tiene que ser tan
 * pequeña como el caso que justifica.
 *
 * Ahora la exención es por línea: se pone este marcador **en la propia línea**, como comentario al
 * final, y la guardia la ignora sólo a ella. En la línea de arriba NO sirve —`sinComentarios` borra
 * las líneas que empiezan con `//` antes del barrido, así que ni llegaría—. Quien lo escriba tiene
 * que decir POR QUÉ ahí no aplica, y el resto del archivo sigue vigilado.
 *
 * El marcador es GENÉRICO a propósito —dice «esta línea no es una partición»— y **la razón concreta
 * va en el comentario de al lado**, que es donde la va a leer quien pase por ahí. Hoy lo usan dos:
 *
 *  • `dominio/pagos/corrida.ts`: filtra su PROPIA tabla `corrida_pago`, cuya columna es NOT NULL
 *    (una corrida es de un segmento o del otro; no existe la «sin definir»), así que ahí `= false`
 *    sí es la mitad exacta;
 *  • `dominio/esma/migracion.ts`: **escribe** `conFactura: null` en lo migrado del Access — es el
 *    ORIGEN de los «sin definir», no un filtro que los deje fuera.
 */
const MARCADOR_EXENTO = 'segmento: no particiona';

/** Quita comentarios para no confundir una explicación con una condición viva. */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linea) => !linea.trim().startsWith('//') && !linea.trim().startsWith('*'))
    .join('\n');
}

/**
 * Las formas de escribir A MANO el criterio del segmento. Se persiguen las del lado `false`/`null`,
 * la EXPRESIÓN (`conFactura: x === 'con'`, que fue la quinta copia del reviewer) y el SQL crudo.
 *
 * 🔎 LÍMITE CONOCIDO, dicho a propósito: `conFactura: true` a secas NO se persigue, porque aparece
 * legítimamente dentro de un `select` de Prisma (`convivencia-esma.ts` lo usa cuatro veces para
 * PEDIR la columna) y desde el texto no se distingue de un filtro. Perseguirlo daría falsos
 * positivos, y una guardia con falsos positivos se acaba desactivando. Tampoco es donde estaba el
 * defecto: **el desacuerdo vivía en el `false`**, y las tres formas de escribirlo sí se cazan.
 */
const MARCAS_SEGMENTO: [nombre: string, patron: RegExp][] = [
  ['conFactura: false', /conFactura:\s*false/],
  ['conFactura: null', /conFactura:\s*null/],
  ["conFactura: <expresión> (p. ej. `s === 'con'`)", /conFactura:\s*[^,\n}]*===/],
  ['"con_factura" = … (SQL crudo)', /"?con_factura"?\s*(?:=|IS|IN)/i],
];

/** ¿Este código menciona el segmento de EsMa (y por tanto la guardia opina sobre él)? */
function hablaDelSegmento(codigo: string): boolean {
  return /conFactura|con_factura/.test(codigo);
}

/** ¿Le pide el criterio a la definición única? */
function usaLaDefinicion(codigo: string): boolean {
  return /whereSegmentoFactura|sqlSegmentoFactura/.test(codigo);
}

/**
 * ⭐ LA DECISIÓN DE LA GUARDIA, en un solo lugar (la usan la capa sintética y la del árbol real, para
 * que lo que se prueba contra código inventado sea EXACTAMENTE lo que corre contra el repo). Un
 * archivo es infractor si escribe a mano alguna forma del criterio del segmento. Devuelve el motivo,
 * o `null` si está limpio.
 */
function motivoDeInfraccion(codigo: string): string | null {
  if (!hablaDelSegmento(codigo)) return null;

  // Se recorre LÍNEA A LÍNEA (no el archivo entero) para poder eximir una sola.
  //
  // ⚠️ El marcador tiene que ir en la MISMA línea, como comentario al final. Nada de aceptarlo en
  // la línea de arriba: `sinComentarios` borra las líneas que empiezan con `//` antes de llegar
  // aquí, así que un marcador suelto encima ni siquiera existiría — y admitirlo aflojaría la regla
  // sin que nadie pudiera usarla.
  const hallazgos: string[] = [];
  codigo.split('\n').forEach((linea, i) => {
    if (linea.includes(MARCADOR_EXENTO)) return;
    for (const [nombre, patron] of MARCAS_SEGMENTO) {
      if (patron.test(linea)) hallazgos.push(`${nombre} (línea ${String(i + 1)})`);
    }
  });
  if (hallazgos.length === 0) return null;

  return usaLaDefinicion(codigo)
    ? `importa la definición pero escribe el criterio a mano: ${hallazgos.join(' · ')}`
    : `escribe el criterio del segmento a mano, sin pedírselo a formula-saldo.ts: ${hallazgos.join(' · ')}`;
}

describe('⭐ guardia (1/2) · los detectores reconocen una quinta copia sintética', () => {
  // Es, letra por letra, la quinta copia con la que el reviewer atravesó la versión ANTERIOR de
  // esta guardia (que sólo miraba una lista fija de cuatro archivos).
  const quintaCopiaPrisma = `const where = { ...base, conFactura: s === 'con' };`;
  const quintaCopiaSql = 'const f = Prisma.sql`AND "con_factura" = FALSE`;';
  const quintaCopiaExplicita = `const where = { OR: [{ conFactura: false }, { conFactura: null }] };`;
  const quintaCopiaTernaria = `conFactura: segmento === undefined ? undefined : segmento === 'con',`;

  it.each([
    ['expresión de Prisma', quintaCopiaPrisma],
    ['SQL crudo', quintaCopiaSql],
    ['el OR explícito copiado', quintaCopiaExplicita],
    ['una ternaria', quintaCopiaTernaria],
  ])('caza la copia escrita como %s', (_forma, codigo) => {
    expect(motivoDeInfraccion(codigo)).not.toBeNull();
  });

  it('⭐ tampoco se deja engañar por una copia que IMPORTA la definición y aun así escribe el criterio', () => {
    const disfrazada = `
      import { whereSegmentoFactura } from './formula-saldo.js';
      const a = { ...base, ...whereSegmentoFactura(segmento) };
      const b = { ...base, conFactura: false };`;
    expect(motivoDeInfraccion(disfrazada)).toContain('escribe el criterio a mano');
  });

  it('no se alarma con quien le pide el criterio a la definición única', () => {
    const correcto = `
      import { whereSegmentoFactura } from './formula-saldo.js';
      const where = { ...base, ...whereSegmentoFactura(segmento) };`;
    expect(motivoDeInfraccion(correcto)).toBeNull();
  });

  it('no se alarma con código que NO habla del segmento', () => {
    expect(motivoDeInfraccion(`const x = { esFiscal: false };`)).toBeNull();
  });
});

/** Los archivos del árbol cuya alguna LÍNEA escribe el criterio a mano (ruta relativa). */
function infractoresDelArbol(): string[] {
  return archivosDeProduccion()
    .map((ruta) => relative(RAIZ, ruta).split(sep).join('/'))
    .filter(
      (relativa) =>
        motivoDeInfraccion(sinComentarios(readFileSync(join(RAIZ, relativa), 'utf8'))) !== null,
    );
}

describe('⭐ guardia (2/2) · el árbol real no tiene ninguna quinta copia', () => {
  it('ninguna LÍNEA de producción escribe el criterio del segmento a mano', () => {
    const infractores: string[] = [];
    for (const ruta of archivosDeProduccion()) {
      const relativa = relative(RAIZ, ruta).split(sep).join('/');
      // NO se salta ningún archivo: la exención es por línea (ver MARCADOR_EXENTO).
      const motivo = motivoDeInfraccion(sinComentarios(readFileSync(ruta, 'utf8')));
      if (motivo !== null) infractores.push(`${relativa} → ${motivo}`);
    }
    expect(
      infractores,
      'Estas LÍNEAS parten por el segmento con un criterio propio. O se lo piden a ' +
        `\`whereSegmentoFactura\`/\`sqlSegmentoFactura\` (formula-saldo.ts), o llevan el marcador ` +
        `\`${MARCADOR_EXENTO}\` en su línea explicando por qué ahí no aplica.`,
    ).toEqual([]);
  });

  it('⭐ y lo demuestra: una quinta copia REAL en el árbol la pone roja', () => {
    // No se confía en el detector sobre texto inventado: se escribe el archivo, se corre la MISMA
    // comprobación que la prueba de arriba, y se borra pase lo que pase.
    const intruso = join(RAIZ, 'src', 'dominio', 'esma', '__quinta-copia-temporal.ts');
    writeFileSync(
      intruso,
      "import { Prisma } from '../../datos/index.js';\n" +
        "export function segmentar(s: 'con' | 'sin') {\n" +
        "  return { conFactura: s === 'con' };\n" +
        '}\n' +
        'export const crudo = Prisma.sql`AND "con_factura" = FALSE`;\n',
      'utf8',
    );
    try {
      expect(infractoresDelArbol()).toContain('src/dominio/esma/__quinta-copia-temporal.ts');
    } finally {
      rmSync(intruso, { force: true });
    }
    expect(existsSync(intruso)).toBe(false);
  });

  it('⭐⭐ una copia nueva en un archivo QUE YA TIENE una línea exenta también se caza', () => {
    // 🔴 Éste es el agujero que la exención por ARCHIVO dejaba abierto: `corrida.ts` tiene una línea
    // legítima (su tabla propia, NOT NULL) y con la versión anterior eso lo sacaba ENTERO del
    // barrido, así que una quinta copia 200 líneas más abajo pasaba en verde. Aquí se le mete una
    // copia de verdad al mismo archivo y se exige que se cace.
    const ruta = join(RAIZ, 'src', 'dominio', 'pagos', 'corrida.ts');
    const original = readFileSync(ruta, 'utf8');
    // Antes de tocarlo está limpio: su única línea con criterio lleva el marcador.
    expect(infractoresDelArbol()).not.toContain('src/dominio/pagos/corrida.ts');
    try {
      writeFileSync(
        ruta,
        `${original}\nexport function copiaClandestina(s: 'con' | 'sin') {\n  return { conFactura: s === 'con' };\n}\n`,
        'utf8',
      );
      expect(infractoresDelArbol()).toContain('src/dominio/pagos/corrida.ts');
    } finally {
      writeFileSync(ruta, original, 'utf8');
    }
    expect(readFileSync(ruta, 'utf8')).toBe(original);
    expect(infractoresDelArbol()).not.toContain('src/dominio/pagos/corrida.ts');
  });

  it('⭐ el MARCADOR se usa de verdad, y quitarlo pone roja su línea', () => {
    // Una exención que ya no corresponde a ninguna línea es basura que se pudre; y una que nadie
    // comprueba es una puerta abierta. Se hacen las dos preguntas.
    const ruta = join(RAIZ, 'src', 'dominio', 'pagos', 'corrida.ts');
    const original = readFileSync(ruta, 'utf8');
    expect(original).toContain(MARCADOR_EXENTO);
    try {
      writeFileSync(ruta, original.replaceAll(` // ${MARCADOR_EXENTO}`, ''), 'utf8');
      expect(infractoresDelArbol()).toContain('src/dominio/pagos/corrida.ts');
    } finally {
      writeFileSync(ruta, original, 'utf8');
    }
    expect(readFileSync(ruta, 'utf8')).toBe(original);
  });
});
