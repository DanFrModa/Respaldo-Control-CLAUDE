/**
 * Pruebas PURAS del pre-filtro de búsqueda sin acentos (`comun/busqueda.ts`, fila 0.205).
 *
 * Aquí se mide la FORMA del SQL, que es donde viven las dos garantías del módulo y las dos se
 * pueden romper sin que ninguna prueba de integración se entere:
 *
 *  1. **Seguridad.** El identificador (tabla y columna) NO se puede parametrizar en Postgres, así
 *     que sale de una whitelist; lo único del usuario que viaja es el patrón, y viaja como VALOR.
 *     Si alguien "simplifica" metiendo el texto con `Prisma.raw`, el SQL sigue funcionando
 *     perfectamente contra la base —y las pruebas de integración siguen VERDES— con una inyección
 *     abierta. Sólo una prueba sobre el SQL crudo lo caza.
 *  2. **`unaccent` en AMBOS lados.** Quitarlo de UNO de los dos lados deja la búsqueda funcionando
 *     para el caso fácil (texto sin acentos contra valor sin acentos) y rota justo en el caso que
 *     esta fila vino a arreglar.
 *
 * El "sí encuentra «Ámbar»" de verdad —el que cruza contra Postgres con la extensión instalada—
 * vive en las `.int.test.ts` de cada catálogo.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { escaparLike, sqlIdsPorTextoSinAcentos, type CatalogoBuscable } from './busqueda.js';

/** Sube desde el cwd hasta la carpeta `backend/` (la que tiene `src/dominio`). */
function raizBackend(): string {
  let directorio = process.cwd();
  for (;;) {
    if (existsSync(join(directorio, 'src', 'dominio'))) return directorio;
    const padre = dirname(directorio);
    if (padre === directorio) {
      throw new Error(`No encontré la raíz de backend/ subiendo desde ${process.cwd()}`);
    }
    directorio = padre;
  }
}

/**
 * Todos los archivos con la extensión dada bajo un directorio, recursivo (sin `node_modules` ni el
 * cliente generado). Sirve para los `.ts` del código y para los `.sql` de las migraciones, porque el
 * orden malo cabe en los dos sitios.
 */
function archivosConExtension(directorio: string, extension: string): string[] {
  if (!existsSync(directorio)) return [];
  const salida: string[] = [];
  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules' || entrada.name === 'generated') continue;
      salida.push(...archivosConExtension(ruta, extension));
    } else if (entrada.name.endsWith(extension)) {
      salida.push(ruta);
    }
  }
  return salida;
}

/**
 * El orden PROHIBIDO, armado en trozos a propósito: así su literal no aparece en este archivo y el
 * guardián del final puede escanear TODO `src/` —incluidas las pruebas— sin encontrarse a sí mismo.
 */
const ORDEN_PROHIBIDO = `unaccent${'('}lower(`;

/**
 * Las columnas que cada catálogo DEBE comparar: las mismas que su dominio buscaba con
 * `contains mode: 'insensitive'` antes de la fila 0.205. Se escriben a mano (no se leen de la
 * whitelist) a propósito: así la prueba detecta que alguien añada o quite un campo buscable, que
 * es un cambio de COMPORTAMIENTO y no de esta fila.
 */
const COLUMNAS_ESPERADAS: Record<CatalogoBuscable, readonly string[]> = {
  proveedor: ['t.nombre'],
  cliente: ['t.nombre'],
  color: ['t.nombre'],
  avio: ['t.clave', 't.descripcion'],
  modelo: ['t.codigo', 't.codigo_desarrollo', 't.descripcion'],
  // Las tres últimas viven en tablas VECINAS (el proveedor dueño y el grid de colores) y se
  // consultan con `EXISTS`, con alias `v`.
  tela: ['t.nombre', 't.nombre_proveedor', 'v.nombre', 'v.nombre', 'v.pantone'],
};

const CATALOGOS = Object.keys(COLUMNAS_ESPERADAS) as CatalogoBuscable[];

/** El SQL con los placeholders numerados (`$1`…), tal como lo recibe Postgres. */
function textoSql(catalogo: CatalogoBuscable, busqueda: string): string {
  return sqlIdsPorTextoSinAcentos(catalogo, busqueda).text;
}

describe('escaparLike', () => {
  it('escapa los comodines de LIKE del texto del usuario', () => {
    expect(escaparLike('100%')).toBe('100\\%');
    expect(escaparLike('a_b')).toBe('a\\_b');
    expect(escaparLike('c\\d')).toBe('c\\\\d');
    expect(escaparLike('ambar')).toBe('ambar');
  });
});

describe('sqlIdsPorTextoSinAcentos — seguridad (el texto del usuario nunca es SQL)', () => {
  it.each(CATALOGOS)('en %s el texto viaja como VALOR, no dentro del SQL', (catalogo) => {
    // Un texto que sería catastrófico interpolado: comilla + comentario + punto y coma.
    const malicioso = "x'; DROP TABLE colores; --";
    const consulta = sqlIdsPorTextoSinAcentos(catalogo, malicioso);

    // Las DOS formas del mismo SQL (`?` y `$1`): ninguna lleva el texto dentro.
    for (const sql of [consulta.sql, consulta.text]) {
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).not.toContain(malicioso);
    }
    // Un parámetro por comparación, y todos con el patrón escapado del usuario.
    expect(consulta.values).toEqual(
      COLUMNAS_ESPERADAS[catalogo].map(() => `%${escaparLike(malicioso)}%`),
    );
  });

  it('el patrón lleva los comodines del usuario ya escapados', () => {
    const consulta = sqlIdsPorTextoSinAcentos('color', '50%_azul');
    expect(consulta.values).toEqual(['%50\\%\\_azul%']);
  });
});

describe('sqlIdsPorTextoSinAcentos — lower(unaccent(...)) en AMBOS lados', () => {
  it.each(CATALOGOS)('%s compara cada columna suya sin acentos ni mayúsculas', (catalogo) => {
    const sql = textoSql(catalogo, 'ambar');
    const columnas = COLUMNAS_ESPERADAS[catalogo];

    for (const columna of columnas) {
      // Lado IZQUIERDO: la columna, con COALESCE (simetría con `candidatos-desarrollo.ts`).
      expect(sql).toContain(`lower(unaccent(COALESCE(${columna}, '')))`);
    }
    // Lado DERECHO: el parámetro, también envuelto — uno por columna.
    const ladosDerechos = sql.match(/LIKE lower\(unaccent\(\$\d+\)\)/g) ?? [];
    expect(ladosDerechos).toHaveLength(columnas.length);
    // Y ninguna comparación quedó a medias: tantos LIKE como columnas, ni uno más.
    expect(sql.match(/LIKE/g) ?? []).toHaveLength(columnas.length);
  });

  /**
   * ⭐ El ORDEN, fijado. `lower(unaccent(x))` y `unaccent(lower(x))` dan el mismo resultado en una
   * base con locale UTF-8 —o sea que **invertirlo no pone roja ninguna otra prueba, ni en el CI**—
   * pero el segundo ata la búsqueda al `LC_CTYPE` del servidor y con locale `C` falla en todo valor
   * acentuado en MAYÚSCULA (los catálogos de este sistema se capturan así). Le costó 5 rojas falsas
   * al coder de la fila 0.205 midiendo en local. Esta aserción es lo único que impide que alguien
   * lo "normalice" de vuelta sin enterarse.
   */
  it.each(CATALOGOS)('%s pone unaccent POR DENTRO de lower, nunca al revés', (catalogo) => {
    const sql = textoSql(catalogo, 'ambar');
    const columnas = COLUMNAS_ESPERADAS[catalogo];
    // `unaccent` es un diccionario (no depende del locale) y trae las dos cajas de cada letra: al
    // aplicarlo primero, a `lower` ya sólo le queda ASCII, que baja igual en cualquier locale.
    expect(sql.match(/lower\(unaccent\(/g) ?? []).toHaveLength(columnas.length * 2);
    expect(sql).not.toContain(ORDEN_PROHIBIDO);
  });

  it('las columnas se unen con OR (cualquiera de ellas basta)', () => {
    expect(textoSql('avio', 'ambar').match(/ OR /g) ?? []).toHaveLength(1);
    expect(textoSql('modelo', 'ambar').match(/ OR /g) ?? []).toHaveLength(2);
    // tela: 2 columnas propias + 2 `EXISTS` = 3 OR arriba, más 1 OR DENTRO del EXISTS del grid
    // de colores (nombre O pantone) = 4 en total.
    expect(textoSql('tela', 'ambar').match(/ OR /g) ?? []).toHaveLength(4);
    // Una sola columna: no hay OR que unir.
    expect(textoSql('color', 'ambar')).not.toContain(' OR ');
  });
});

describe('sqlIdsPorTextoSinAcentos — la tabla raíz y sus vecinas', () => {
  it.each([
    ['proveedor', '"proveedores" t'],
    ['cliente', '"clientes" t'],
    ['color', '"colores" t'],
    ['avio', '"avios" t'],
    ['modelo', '"modelos" t'],
    ['tela', '"telas" t'],
  ] as [CatalogoBuscable, string][])('%s lee de %s', (catalogo, tabla) => {
    expect(textoSql(catalogo, 'ambar')).toContain(`FROM ${tabla}`);
  });

  it('tela alcanza su proveedor y su grid de colores por EXISTS (nunca por JOIN)', () => {
    const sql = textoSql('tela', 'ambar');
    expect(sql).toContain('EXISTS (SELECT 1 FROM "proveedores" v WHERE v.id = t.id_proveedor AND');
    expect(sql).toContain('EXISTS (SELECT 1 FROM "telas_colores" v WHERE v.id_tela = t.id AND');
    // 🔑 Por qué importa la forma: un JOIN devolvería el id de la tela una vez POR COLOR. El
    // resultado visible saldría igual (el `id IN (…)` de Prisma deduplica), pero la lista de ids
    // crecería con el grid y la consulta cuesta ~3× más (medido: ~40 ms vs ~15 ms).
    expect(sql).not.toContain('JOIN');
    expect(sql).not.toContain('DISTINCT');
  });

  it.each(CATALOGOS)('%s devuelve el id de la tabla RAÍZ (alias t), no del vecino', (catalogo) => {
    expect(textoSql(catalogo, 'ambar')).toContain('SELECT t.id FROM');
  });

  it.each(CATALOGOS)('ningún catálogo necesita DISTINCT (nada multiplica la raíz)', (catalogo) => {
    expect(textoSql(catalogo, 'ambar')).not.toContain('DISTINCT');
  });
});

/**
 * ⭐⭐ **LA RED QUE IMPIDE QUE EL ORDEN MALO VUELVA A NACER — EN CUALQUIER SITIO, NO SÓLO AQUÍ.**
 *
 * El pre-filtro de este módulo no es el único SQL crudo con `unaccent` del backend: `dominio/
 * pedidos/candidatos-desarrollo.ts` hace lo mismo a mano (cruza tres tablas, así que no cabe en la
 * whitelist del ayudante). Los DOS nacieron con `unaccent(lower(x))` y los dos se invirtieron en la
 * fila 0.205. Una aserción sobre el SQL que genera ESTE archivo no dice nada del otro, ni del
 * tercero que alguien escriba el mes que viene copiando el que tenga más a mano.
 *
 * 🔑 **Y esta es la razón de fondo de que haga falta una red y no baste con revisar:** las dos
 * formas dan el MISMO resultado en una base con locale UTF-8, que es la del CI y la de Railway.
 * Invertir el orden **no pone roja ninguna prueba de integración, ni local ni en el CI**. El defecto
 * sólo aparece en la máquina de quien levante un Postgres con `initdb` por default, y ahí aparece
 * como cinco rojas que parecen ser de su código. Es exactamente el tipo de regresión que nadie ve
 * volver.
 *
 * 📌 **Y "cualquier sitio" incluye las MIGRACIONES.** La red nació mirando sólo `.ts`, pero el orden
 * malo se escribe igual de bien en SQL: la cabecera de `busqueda.ts` deja apuntado que el día que el
 * rendimiento duela se pondrá un índice `GIN pg_trgm` sobre `lower(unaccent(col))`, y eso vive en un
 * `migration.sql`, no en TypeScript. Por eso el escáner barre `src/`, `migracion/` **y** los `.sql`
 * de `prisma/migrations/`.
 *
 * Tres partes, y las tres hacen falta (mismo criterio que `eco-sin-reja.test.ts`):
 *  1. **Que la red mida algo**, contra un fixture sintético. Sin esto, una avería del escáner —un
 *     glob que no casa, un filtro de comentarios que se come el archivo entero— se leería como
 *     «todo limpio», que es un verde peor que un rojo.
 *  2. **Que el árbol real esté limpio**: cero sitios con el orden malo en código.
 *  3. **Un canario de tamaño**: si el escáner se queda corto, la parte 2 saldría verde por no haber
 *     mirado nada.
 */
describe('RED: el orden lower(unaccent(…)) está fijado en TODO el backend', () => {
  /**
   * Las líneas de COMENTARIO se saltan a propósito: la cabecera de `busqueda.ts` y el comentario de
   * `candidatos-desarrollo.ts` nombran el orden malo **para advertir contra él**, y ese aviso es
   * justamente lo que no queremos que la red borre.
   *
   * El estilo de comentario depende del archivo: en SQL el aviso se escribe con `--`, que en
   * TypeScript **no** es un comentario (es el decremento `--i`). Por eso ese prefijo se añade sólo
   * para los `.sql`, en vez de meterlo en la lista común: así no le abre al código TS un hueco por
   * donde el orden malo pueda colarse sin que la red lo vea.
   */
  function lineasDeCodigo(fuente: string, ruta: string): string[] {
    const prefijosDeComentario = ruta.endsWith('.sql')
      ? ['*', '//', '/*', '--']
      : ['*', '//', '/*'];
    return fuente.split('\n').filter((linea) => {
      const limpia = linea.trim();
      return limpia !== '' && !prefijosDeComentario.some((prefijo) => limpia.startsWith(prefijo));
    });
  }

  /** Sitios con el orden PROHIBIDO en código (no en comentarios). */
  function sitiosMalos(archivos: { ruta: string; fuente: string }[]): string[] {
    const hallazgos: string[] = [];
    for (const { ruta, fuente } of archivos) {
      for (const linea of lineasDeCodigo(fuente, ruta)) {
        if (linea.includes(ORDEN_PROHIBIDO)) hallazgos.push(`${ruta}: ${linea.trim()}`);
      }
    }
    return hallazgos;
  }

  it('1. la red MIDE: caza el orden malo en código y NO en un comentario que advierte', () => {
    const malo = `  return sql\`${ORDEN_PROHIBIDO}col)) LIKE ${ORDEN_PROHIBIDO}$1))\`;`;
    const aviso = ` * ⚠️ Nunca uses ${ORDEN_PROHIBIDO}x)): depende del LC_CTYPE.`;
    const bueno = '  return sql`lower(unaccent(col)) LIKE lower(unaccent($1))`;';

    expect(sitiosMalos([{ ruta: 'f.ts', fuente: malo }])).toHaveLength(1);
    // El aviso en prosa NO cuenta (si contara, la red exigiría borrar la advertencia).
    expect(sitiosMalos([{ ruta: 'f.ts', fuente: aviso }])).toHaveLength(0);
    expect(sitiosMalos([{ ruta: 'f.ts', fuente: bueno }])).toHaveLength(0);
    // Y el caso mixto, que es la forma real de los dos archivos de verdad: aviso arriba, código
    // bueno abajo → limpio; pero si el código se invierte, se caza aunque el aviso siga puesto.
    expect(sitiosMalos([{ ruta: 'f.ts', fuente: `${aviso}\n${bueno}` }])).toHaveLength(0);
    expect(sitiosMalos([{ ruta: 'f.ts', fuente: `${aviso}\n${malo}` }])).toHaveLength(1);
  });

  it('1-bis. la red MIDE EN SQL: caza el índice invertido y NO el aviso con `--`', () => {
    // La forma real de lo que se va a escribir algún día: el índice `GIN pg_trgm` que la cabecera de
    // `busqueda.ts` deja apuntado para cuando el rendimiento duela.
    const maloSql = `CREATE INDEX colores_nombre_trgm ON "colores" USING gin (${ORDEN_PROHIBIDO}nombre)) gin_trgm_ops);`;
    const avisoSql = `-- ⚠️ Nunca ${ORDEN_PROHIBIDO}x)): depende del LC_CTYPE del servidor.`;
    const buenoSql =
      'CREATE INDEX colores_nombre_trgm ON "colores" USING gin (lower(unaccent(nombre)) gin_trgm_ops);';

    expect(sitiosMalos([{ ruta: 'm.sql', fuente: maloSql }])).toHaveLength(1);
    expect(sitiosMalos([{ ruta: 'm.sql', fuente: avisoSql }])).toHaveLength(0);
    expect(sitiosMalos([{ ruta: 'm.sql', fuente: buenoSql }])).toHaveLength(0);
    // El caso mixto, que es la forma que tendrá la migración de verdad: aviso arriba, índice bueno
    // abajo → limpio; pero si el índice se invierte, se caza aunque el aviso siga puesto.
    expect(sitiosMalos([{ ruta: 'm.sql', fuente: `${avisoSql}\n${buenoSql}` }])).toHaveLength(0);
    expect(sitiosMalos([{ ruta: 'm.sql', fuente: `${avisoSql}\n${maloSql}` }])).toHaveLength(1);
    // ⭐ Y el `--` NO es un comentario en TypeScript: la misma línea dentro de un `.ts` SÍ se caza.
    // Sin esto, añadir `--` a la lista común le abriría al código TS un hueco silencioso.
    expect(sitiosMalos([{ ruta: 'f.ts', fuente: avisoSql }])).toHaveLength(1);
  });

  it('2. el backend real está LIMPIO, y 3. el escáner de verdad miró', () => {
    const raiz = raizBackend();
    const leer = (ruta: string) => ({
      ruta: relative(raiz, ruta),
      fuente: readFileSync(ruta, 'utf8'),
    });
    const archivosTs = archivosConExtension(join(raiz, 'src'), '.ts')
      .concat(archivosConExtension(join(raiz, 'migracion'), '.ts'))
      .map(leer);
    // ⭐ Las MIGRACIONES también entran. Hasta hoy la red sólo miraba `.ts`, y el orden malo tiene un
    // sitio natural en SQL: un índice `GIN pg_trgm` sobre `lower(unaccent(col))` —el plan que la
    // cabecera de `busqueda.ts` deja apuntado para cuando el rendimiento duela— o una columna
    // generada. Escrito al revés ahí, el índice queda atado al `LC_CTYPE` del servidor y encima
    // **deja de servirle al `WHERE`** (que sí usa el orden bueno), o sea que el defecto se paga dos
    // veces y ninguna prueba de integración se entera.
    const archivosSql = archivosConExtension(join(raiz, 'prisma', 'migrations'), '.sql').map(leer);
    const todos = archivosTs.concat(archivosSql);

    // (2) Cero sitios con el orden malo, ni en el código ni en las migraciones.
    expect(sitiosMalos(todos)).toEqual([]);

    // (3) Canarios: que el escáner haya mirado de verdad. MEDIDO el 26-sep-2026 sobre este árbol:
    // **1,096 archivos .ts**, **124 archivos .sql** (uno por migración) y **18 usos del orden bueno**
    // en código — 2 en `busqueda.ts` (los dos lados de `comparacion()`), 10 en
    // `candidatos-desarrollo.ts` (5 condiciones × 2 lados) y 6 en este archivo; en `.sql` hoy hay
    // CERO (ninguna migración indexa todavía). Las cotas van muy por debajo de lo medido para no
    // romperse al crecer el árbol, pero cazan que el glob deje de casar o que los pre-filtros
    // desaparezcan sin que nadie mire.
    expect(archivosTs.length).toBeGreaterThan(300);
    expect(archivosSql.length).toBeGreaterThan(50);
    const usosBuenos = todos
      .flatMap(({ ruta, fuente }) => lineasDeCodigo(fuente, ruta))
      .flatMap((linea) => linea.match(/lower\(unaccent\(/g) ?? []).length;
    expect(usosBuenos).toBeGreaterThanOrEqual(10);
  });
});
