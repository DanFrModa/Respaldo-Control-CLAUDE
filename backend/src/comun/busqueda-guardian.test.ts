/**
 * ⭐⭐ **RED: QUE NO VUELVA A NACER UN «SITIO 34» (fila 0.214).**
 *
 * La 0.205 cerró cuatro catálogos y dejó, sin saberlo, **33 funciones** buscando con el
 * `contains mode: 'insensitive'` de Prisma —que es ILIKE: ignora mayúsculas pero NO acentos— y otras
 * **6** con `ILIKE` escrito a mano en SQL crudo. La 0.214 las pasó todas a `comun/busqueda.ts`. Lo
 * que esta prueba impide es el siguiente: la función nueva que alguien escriba el mes que viene
 * copiando la que tenga más a mano.
 *
 * 🔑 **Por qué hace falta una red y no basta con revisar:** el `contains` funciona. Pasa sus pruebas,
 * encuentra «AZUL» tecleando «azul», y sólo falla cuando el valor guardado lleva acento y lo tecleado
 * no — que es justo lo que ninguna prueba escrita de prisa siembra. Así nacieron los 33.
 *
 * **El criterio:** *cada `mode: 'insensitive'` cuyo objeto de filtro `{…}` lleve `contains:`*, a
 * cualquiera de los dos lados del `mode`. La fila lo publicó como «la clave más cercana HACIA ATRÁS»,
 * y así nació esta red; el reviewer la tumbó con `{ mode: 'insensitive', contains: x }` (mismo filtro,
 * claves en otro orden), que pasaba en verde. Sobre el código de ANTES de la fila los dos criterios
 * dan el mismo censo —48 ocurrencias, 33 funciones, 30 archivos—, comprobado el 6-oct-2026 corriendo
 * este escáner contra `origin/prueba`; el escáner vive aparte (`src/pruebas/escaner-busqueda.ts`)
 * justo para poder hacer eso. Los `equals` con `mode: 'insensitive'` NO cuentan, a propósito: no son
 * búsqueda del usuario sino comparaciones de identidad (¿este código ya existe?), y doblarles el
 * acento cambiaría qué cuenta como repetido — decisión distinta, fila distinta.
 *
 * Tres partes, y las tres hacen falta (mismo criterio que la red del orden en `busqueda.test.ts`):
 *  1. **Que la red mida algo**, contra fixtures sintéticos — incluidos el caso que engañó al primer
 *     barrido de la fila (un `equals` lejano, más de cuatro líneas arriba) y el que engañó a la
 *     primera versión de esta red (el `contains` DESPUÉS del `mode`).
 *  2. **Que el árbol real esté limpio**, salvo la lista blanca (cada entrada con su razón).
 *  3. **Canarios de tamaño**: que el escáner haya mirado de verdad.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fuentesDeCodigo, ilikesACodigo, ocurrencias } from '../pruebas/escaner-busqueda.js';

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
 * LISTA BLANCA — sitios que pueden seguir con `contains` + `mode: 'insensitive'` (o con `ILIKE`),
 * cada uno con su razón. **Hoy está VACÍA**: los 33 de la fila y los 6 `ILIKE` pasaron todos por
 * `comun/busqueda.ts`. Para meter uno, la razón tiene que explicar por qué ahí NO importa que «nino»
 * no encuentre «Niño» (p. ej. un campo que por construcción sólo lleva ASCII).
 */
const LISTA_BLANCA: Readonly<Record<string, string>> = {};

describe('RED: ninguna búsqueda de texto vuelve al `contains` de Prisma que no dobla acentos', () => {
  it('1. la red MIDE: caza el contains, respeta el equals… aunque esté lejos', () => {
    const contains = `where: { nombre: { contains: texto, mode: 'insensitive' } }`;
    const equals = `where: { codigo: { equals: texto, mode: 'insensitive' } }`;
    // El caso que engañó al primer barrido: la clave a SEIS líneas del `mode`.
    const equalsLejano = [
      'where: {',
      '  codigo: {',
      '    equals:',
      '      texto',
      '        .trim()',
      '        .toUpperCase(),',
      "    mode: 'insensitive',",
      '  },',
      '}',
    ].join('\n');
    // Y su espejo: un `equals` ANTES en el archivo no tapa a un `contains` posterior.
    const equalsYLuegoContains = `${equals}\n${contains}`;

    expect(ocurrencias('f.ts', contains).map((o) => o.clave)).toEqual(['contains']);
    expect(ocurrencias('f.ts', equals).map((o) => o.clave)).toEqual(['equals']);
    expect(ocurrencias('f.ts', equalsLejano).map((o) => o.clave)).toEqual(['equals']);
    expect(ocurrencias('f.ts', equalsYLuegoContains).map((o) => o.clave)).toEqual([
      'equals',
      'contains',
    ]);
    // `insensitive` sin clave de filtro delante no inventa una.
    expect(ocurrencias('f.ts', "mode: 'insensitive'").map((o) => o.clave)).toEqual([null]);
    // Y el que se nombra en un COMENTARIO no cuenta, aunque haya un `contains:` arriba.
    expect(ocurrencias('f.ts', `${contains}\n * el \`mode: 'insensitive'\` no dobla`)).toHaveLength(
      1,
    );
  });

  /**
   * 🔴 La mutación que tumbó la primera versión de esta red (reviewer de la 0.214): el MISMO filtro
   * con las claves en otro orden. Mirando sólo hacia atrás, lo más cercano era el `in:` de la
   * expresión anterior —así salió en `auditores.ts`— y el `contains` pasaba en verde.
   */
  it('1-ter. la red MIDE el contains DESPUÉS del mode (Prisma acepta las claves en cualquier orden)', () => {
    const alReves = `{ nombre: { mode: 'insensitive', contains: filtros.busqueda } }`;
    // La forma exacta en que sobrevivió: un `in:` en la línea de arriba.
    const conInArriba = [
      '    ...(filtros.estado === undefined ? {} : { id: { in: ids } }),',
      "    ...{ nombre: { mode: 'insensitive', contains: filtros.busqueda } },",
    ].join('\n');
    // Y en varias líneas, con el `contains` lejos por abajo.
    const multilinea = [
      'nombre: {',
      "  mode: 'insensitive',",
      '',
      '  contains:',
      '    texto,',
      '}',
    ].join('\n');
    expect(ocurrencias('f.ts', alReves).map((o) => o.clave)).toEqual(['contains']);
    expect(ocurrencias('f.ts', conInArriba).map((o) => o.clave)).toEqual(['contains']);
    expect(ocurrencias('f.ts', multilinea).map((o) => o.clave)).toEqual(['contains']);
    // Y el equals al revés sigue siendo equals (no se cuenta todo como contains).
    expect(
      ocurrencias('f.ts', `{ codigo: { mode: 'insensitive', equals: x } }`).map((o) => o.clave),
    ).toEqual(['equals']);
    // Las claves de un objeto ANIDADO son de otro filtro: no se le atribuyen al `mode`.
    expect(
      ocurrencias('f.ts', `{ OR: [{ nombre: { contains: x } }], mode: 'insensitive' }`).map(
        (o) => o.clave,
      ),
    ).toEqual([null]);
  });

  it('1-bis. la red MIDE el ILIKE a mano, y NO el que se nombra en un comentario', () => {
    expect(ilikesACodigo('f.ts', '  Prisma.sql`c."nombre" ILIKE ${patron}`')).toEqual(['f.ts:1']);
    expect(ilikesACodigo('f.ts', ' * el `contains` de Prisma (ILIKE) no dobla acentos')).toEqual(
      [],
    );
    expect(ilikesACodigo('f.ts', '  // aquí había un ILIKE')).toEqual([]);
  });

  it('2. el backend real está LIMPIO, y 3. el escáner de verdad miró', () => {
    const raiz = raizBackend();
    const archivos = fuentesDeCodigo(join(raiz, 'src'))
      .concat(fuentesDeCodigo(join(raiz, 'migracion')))
      .map((ruta) => ({ ruta: relative(raiz, ruta), fuente: readFileSync(ruta, 'utf8') }));

    const todas = archivos.flatMap(({ ruta, fuente }) => ocurrencias(ruta, fuente));
    const conContains = todas
      .filter((o) => o.clave === 'contains')
      .map((o) => `${o.ruta}:${o.linea}`)
      .filter((sitio) => !(sitio.split(':')[0]! in LISTA_BLANCA));
    const ilikes = archivos
      .flatMap(({ ruta, fuente }) => ilikesACodigo(ruta, fuente))
      .filter((sitio) => !(sitio.split(':')[0]! in LISTA_BLANCA));

    // (2) Si esto se pone rojo: esa búsqueda tiene que pasar por `comun/busqueda.ts`
    // (`idsSiHayBusqueda` para un `where` de Prisma, `condicionContieneSinAcentos` para SQL crudo).
    expect(conContains).toEqual([]);
    expect(ilikes).toEqual([]);

    // (3) Canarios. MEDIDO el 6-oct-2026 sobre este árbol, después de la fila 0.214: CERO `contains`
    // y el resto `equals`/`startsWith`/`in` (comparaciones de identidad, que se quedan); 654
    // `.ts` de código en `src` + `migracion`. Las cotas van muy por debajo para no
    // romperse al crecer el árbol, pero cazan que el glob deje de casar o que el clasificador se
    // averíe y lo mande todo a `null` (que la parte 2 leería como «limpio»).
    expect(archivos.length).toBeGreaterThan(300);
    expect(todas.filter((o) => o.clave === 'equals').length).toBeGreaterThanOrEqual(30);
    expect(todas.filter((o) => o.clave === null).length).toBeLessThan(10);
  });
});
