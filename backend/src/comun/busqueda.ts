/**
 * Búsqueda de texto SIN ACENTOS ni mayúsculas (rediseño R2, §4.4.1: teclear "oscar" debe
 * encontrar a "Óscar Jiménez"). El `contains mode: 'insensitive'` de Prisma (ILIKE) ignora
 * mayúsculas pero NO acentos, así que los typeaheads se quedaban vacíos justo en el caso que
 * pidió Daniel. Aquí se resuelve con la extensión contrib `unaccent` (migración
 * `20260707140000_r2_unaccent`): un pre-filtro de IDS por SQL crudo PARAMETRIZADO que se compone
 * con el resto del `where` de Prisma (activos, roles, categoría, paginación intactos).
 *
 * Alcance (fila 0.205): los SEIS catálogos que alimentan un typeahead con búsqueda EN SERVIDOR
 * — proveedores y clientes (R2) y, desde esta fila, **colores, telas, avíos y modelos**. El
 * disparador fue el reporte de Daniel del 26-sep-2026: teclear `ambar` no encontraba «Ámbar».
 * En `SelectorColor` el síntoma era doble, porque las dos mitades de la misma lista no se
 * comportaban igual: los colores retirados con mercancía se filtran EN CLIENTE con
 * `filtrarOpciones` (`ComboboxBuscable.tsx`), que sí normaliza acentos ⇒ el mismo texto tecleado
 * encontraba al retirado y no al activo. Con el pre-filtro las dos mitades coinciden.
 *
 * ## 🔴 EL ORDEN ES `lower(unaccent(x))`, NUNCA `unaccent(lower(x))` — Y NO ES ESTÉTICA
 *
 * Las dos formas dan el MISMO resultado mientras la base tenga un locale UTF-8, pero
 * `unaccent(lower(x))` **depende del `LC_CTYPE` del servidor** y la otra no. Con locale `C`,
 * `lower()` sólo baja el ASCII y deja los acentos en pie, así que la comparación se rompe **en
 * todo valor acentuado escrito en MAYÚSCULA** — justo los catálogos de este sistema, que se
 * capturan en mayúsculas («ÁMBAR», «ALGODÓN», «NIÑO»). Medido en Postgres el 26-sep-2026, en dos
 * bases del mismo cluster (una `C`, otra `C.utf8`):
 *
 * | | locale `C` | locale `C.utf8` |
 * |---|---|---|
 * | `lower('ÁMBAR')` | `'Ámbar'` ⚠️ | `'ámbar'` |
 * | `unaccent(lower('ÁMBAR'))` | `'Ambar'` ❌ | `'ambar'` ✅ |
 * | `unaccent(lower('NIÑO'))` | **`'niNo'`** ❌ | `'nino'` ✅ |
 * | `unaccent(lower('ALGODÓN'))` | `'algodOn'` ❌ | `'algodon'` ✅ |
 * | **`lower(unaccent(…))`** (los tres) | `'ambar'`/`'nino'`/`'algodon'` ✅ | idem ✅ |
 *
 * Fíjate en `'niNo'`: con el orden viejo la cosa no falla limpio, **devuelve un engendro** — `lower`
 * dejó la `Ñ` en pie y `unaccent` la convirtió luego en `N` mayúscula. Ninguno de los tres valores
 * casa con lo que teclea el usuario.
 *
 * `unaccent()` es un diccionario (tabla `unaccent.rules`), no depende del locale, y trae las dos
 * cajas de cada letra (`Á`→`A`, `á`→`a`): al aplicarlo PRIMERO, a `lower()` ya sólo le queda
 * ASCII, que baja igual en cualquier locale.
 *
 * ⚠️ **Y esto YA MORDIÓ, no es una precaución teórica.** Con el orden viejo, quien midiera las
 * pruebas de integración en un Postgres local levantado con `initdb` por default (locale `C`, el
 * default de una máquina sin locales instalados) se llevaba **5 rojas FALSAS** en este mismo
 * módulo y tenía que re-crear la base para entenderlo. Le pasó al coder de la fila 0.205. El CI
 * (`postgres:17`) y Railway van en UTF-8, así que en verde nunca se notó: el precio lo pagaba
 * quien medía en local, y el ayudante no lo avisaba en ninguna parte. Ahora sí.
 *
 * Comprobado las dos direcciones sobre el MISMO cluster, una base por locale (26-sep-2026):
 * `busqueda.int.test.ts` + `candidatos-desarrollo.int.test.ts` dan **20/20 verde en `C` y en
 * `C.utf8`** con este orden, y **5 rojas en `C`** al devolverlos al orden viejo.
 *
 * 🔒 Lo fija `busqueda.test.ts` → *«RED: el orden lower(unaccent(…)) está fijado en TODO el
 * backend»*, que escanea el árbol entero: invertirlo aquí **o en el gemelo a mano de
 * `dominio/pedidos/candidatos-desarrollo.ts`** pone la prueba roja. Hace falta una red y no basta
 * con revisar, porque invertir el orden NO rompe nada en una base UTF-8: el CI seguiría verde.
 *
 * Volumen: son catálogos chicos-medianos y el pre-filtro es un seq scan sin índice funcional.
 * Medido en Postgres con datos sintéticos al volumen real (26-sep-2026, 3-5 corridas cada uno):
 * `modelos` 5,400 filas → **10-15 ms**; `colores` 5,000 → **5-6 ms**; `telas` 2,000 con 12,000
 * colores y 300 proveedores → **13-17 ms**. El seq scan sigue bastando. Si algún día duele, el
 * arreglo es un índice GIN `pg_trgm` sobre `lower(unaccent(col))` — que es MIGRACIÓN, no un
 * cambio de este archivo (y el índice tendría que llevar el MISMO orden que la consulta, o no se
 * usaría).
 */
import { Prisma, type PrismaClient } from '../datos/index.js';

import type { Tx } from './transaccion.js';

/** Catálogo con búsqueda de texto sin acentos. */
export type CatalogoBuscable = 'proveedor' | 'cliente' | 'color' | 'avio' | 'modelo' | 'tela';

/**
 * Tabla VECINA cuyas columnas también se buscan (el proveedor dueño de una tela, su grid de
 * colores). Se consulta con `EXISTS`, no con JOIN, y la razón es el COSTE, medido: con JOIN +
 * `DISTINCT` la misma consulta tarda ~40 ms donde ésta tarda ~15 (2,000 telas con 12,000 colores).
 *
 * ⚠️ Lo que NO es la razón, aunque suene mejor: el resultado visible sale igual con JOIN. Un JOIN
 * devuelve el id de la tela una vez POR COLOR, pero esos ids acaban en un `id IN (…)` de Prisma,
 * que los deduplica solo — se comprobó mutando este archivo a JOIN y las pruebas de integración
 * siguieron verdes. Lo que sí crece es la LISTA de ids (y con ella el tamaño de la consulta
 * siguiente), en proporción al grid de colores. `EXISTS` filtra la raíz sin multiplicarla.
 */
interface VecinoBuscable {
  /** Tabla vecina con su alias, siempre `v`. */
  tabla: string;
  /** Cómo se liga el vecino a la raíz `t`. */
  liga: string;
  /** Columnas buscables del vecino, calificadas con `v.`. */
  columnas: readonly string[];
}

/** Cómo se busca en un catálogo: su tabla raíz, sus columnas y sus vecinas. */
interface CatalogoDefinicion {
  /** Tabla raíz con su alias, siempre `t` (es la que aporta el `id` que se devuelve). */
  tabla: string;
  /** Columnas buscables de la tabla raíz, calificadas con `t.`. */
  columnas: readonly string[];
  vecinos?: readonly VecinoBuscable[];
}

/**
 * Catálogos habilitados (whitelist). Postgres NO deja parametrizar identificadores, así que
 * **ni las tablas ni las columnas ni las ligas se parametrizan**: todas salen de aquí y jamás de
 * texto del usuario. Lo único del usuario que viaja es el patrón, y viaja como VALOR.
 *
 * Las columnas son EXACTAMENTE las que cada dominio ya buscaba con `contains mode: 'insensitive'`:
 * esta fila arregla **cómo** se compara, no **qué** se busca.
 */
const CATALOGOS_BUSCABLES: Record<CatalogoBuscable, CatalogoDefinicion> = {
  proveedor: { tabla: '"proveedores" t', columnas: ['t.nombre'] },
  cliente: { tabla: '"clientes" t', columnas: ['t.nombre'] },
  color: { tabla: '"colores" t', columnas: ['t.nombre'] },
  avio: { tabla: '"avios" t', columnas: ['t.clave', 't.descripcion'] },
  // Un modelo promovido tiene DOS números y los DOS son buscables (§Post-F9.34 punto 5).
  modelo: { tabla: '"modelos" t', columnas: ['t.codigo', 't.codigo_desarrollo', 't.descripcion'] },
  // La búsqueda de tela mira también el nombre del PROVEEDOR dueño y el nombre/pantone de sus
  // colores (Daniel, 30-jul-2026: en el almacén se busca "negro" o "alsatex" más seguido que el
  // nombre exacto de la tela).
  tela: {
    tabla: '"telas" t',
    columnas: ['t.nombre', 't.nombre_proveedor'],
    vecinos: [
      { tabla: '"proveedores" v', liga: 'v.id = t.id_proveedor', columnas: ['v.nombre'] },
      {
        tabla: '"telas_colores" v',
        liga: 'v.id_tela = t.id',
        columnas: ['v.nombre', 'v.pantone'],
      },
    ],
  },
};

/** Escapa los comodines de LIKE (`%`, `_`, `\`) del texto del usuario (el escape default es `\`). */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (caracter) => `\\${caracter}`);
}

/**
 * Una comparación «esta columna CONTIENE el patrón, sin acentos ni mayúsculas»: `lower(unaccent())`
 * en AMBOS lados. Dos cosas que no se pueden tocar:
 *  - **En los dos lados.** Quitarlo de uno solo deja la búsqueda funcionando para el caso fácil
 *    (texto sin acentos contra valor sin acentos) y rota justo en el caso con acento.
 *  - **En ESE orden.** `unaccent` por fuera de `lower` ata la búsqueda al `LC_CTYPE` del servidor;
 *    la cabecera de este archivo lo explica con la medición.
 *
 * El `COALESCE` no protege de nada: en una columna NULL la comparación da NULL, que en un `OR` deja
 * la fila fuera exactamente igual. Está por SIMETRÍA con el pre-filtro hermano de
 * `candidatos-desarrollo.ts`, punto.
 */
function comparacion(columna: string, patron: string): Prisma.Sql {
  return Prisma.sql`lower(unaccent(COALESCE(${Prisma.raw(columna)}, ''))) LIKE lower(unaccent(${patron}))`;
}

/**
 * SQL del pre-filtro: los ids del catálogo en los que ALGUNA de sus columnas buscables —propias o
 * de una tabla vecina— contiene `busqueda`, ignorando acentos y mayúsculas (`lower(unaccent())`,
 * en ese orden: ver la cabecera). El texto viaja PARAMETRIZADO —nunca interpolado— y con sus
 * comodines escapados.
 *
 * Se exporta APARTE de la consulta para poder verificar su forma sin base de datos (que el texto
 * del usuario sea un parámetro y no parte del SQL es la garantía de seguridad de este módulo).
 */
export function sqlIdsPorTextoSinAcentos(catalogo: CatalogoBuscable, busqueda: string): Prisma.Sql {
  const { tabla, columnas, vecinos = [] } = CATALOGOS_BUSCABLES[catalogo];
  const patron = `%${escaparLike(busqueda)}%`;

  const condiciones: Prisma.Sql[] = columnas.map((columna) => comparacion(columna, patron));
  for (const vecino of vecinos) {
    const suyas = Prisma.join(
      vecino.columnas.map((columna) => comparacion(columna, patron)),
      ' OR ',
    );
    condiciones.push(
      Prisma.sql`EXISTS (SELECT 1 FROM ${Prisma.raw(vecino.tabla)} WHERE ${Prisma.raw(
        vecino.liga,
      )} AND (${suyas}))`,
    );
  }

  return Prisma.sql`SELECT t.id FROM ${Prisma.raw(tabla)} WHERE ${Prisma.join(condiciones, ' OR ')}`;
}

/**
 * IDs del catálogo que coinciden con `busqueda` sin acentos ni mayúsculas. Devuelve la lista para
 * componer `id: { in: ids }` con el resto del filtro Prisma — lista vacía = ninguna coincidencia
 * (la página sale vacía sola). Cada id aparece UNA vez: los vecinos van por `EXISTS`, que filtra
 * la fila raíz sin multiplicarla.
 */
export async function idsPorTextoSinAcentos(
  cliente: Tx | PrismaClient,
  catalogo: CatalogoBuscable,
  busqueda: string,
): Promise<number[]> {
  const filas = await cliente.$queryRaw<{ id: number }[]>(
    sqlIdsPorTextoSinAcentos(catalogo, busqueda),
  );
  return filas.map((fila) => fila.id);
}
