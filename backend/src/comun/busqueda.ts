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
 * **Fila 0.214: TODA búsqueda de texto del usuario pasa por aquí.** La 0.205 dejó 33 funciones con
 * el `contains mode: 'insensitive'` de siempre (48 ocurrencias en 30 archivos); ésta las pasa todas
 * al pre-filtro —empezando por el octavo typeahead, `SelectorOrden` → `armarBusqueda` de órdenes—
 * y cubre también los 6 `ILIKE` a mano que el criterio de la fila no veía (con
 * {@link condicionContieneSinAcentos}). Que no vuelva a nacer un sitio 34 lo fija
 * `busqueda-guardian.test.ts`, que escanea el backend entero.
 *
 * ## Dos formas de usarlo
 *
 *  1. **Pre-filtro de ids** ({@link idsPorTextoSinAcentos} / {@link idsSiHayBusqueda}) para los
 *     `where` de Prisma: devuelve la lista de ids que casan, y el dominio la compone con el resto del
 *     filtro (`id: { in: ids }`, o `idCliente: { in: ids }` cuando lo que se busca es el nombre de
 *     una relación que ya es catálogo). Lo que se busca en una tabla VECINA (el cliente de la orden,
 *     sus referencias) va por una subconsulta `IN` dentro del mismo SQL — ver {@link VecinoBuscable}.
 *  2. **Condición suelta** ({@link condicionContieneSinAcentos}) para el SQL crudo que ya existe y
 *     arma su propio `WHERE` (concentrado RC, ventas, existencias de tela…).
 *
 * ## El techo de la lista de ids — MEDIDO
 *
 * Prisma manda cada id de un `in: [...]` como un parámetro, y Postgres admite **32,767 por
 * consulta**. Medido el 6-oct-2026 contra Postgres 16 con Prisma 7.8: `count`/`findMany` con
 * **30,000** ids pasan; con **32,766** truenan con *«The query parameter limit supported by your
 * database is exceeded»*. Hoy ninguna tabla de las que se buscan se acerca (la más grande es el
 * archivo histórico de órdenes, **5,451** filas y congelado; las órdenes vivas rondan las 4,000), y
 * las tablas transaccionales se acotan además por EMPRESA dentro del propio pre-filtro
 * (`columnaEmpresa`), que es lo que mantiene la lista del tamaño de una empresa y no de la base.
 * Si algún día una tabla buscable pasa de ~30,000 filas por empresa, el arreglo NO es partir la
 * lista: es mover esa búsqueda a SQL crudo con {@link condicionContieneSinAcentos}.
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
 * backend»*, que escanea el árbol entero: invertirlo aquí **o en cualquier SQL crudo nuevo** pone
 * la prueba roja (el gemelo a mano que tenía `dominio/pedidos/candidatos-desarrollo.ts` ya no existe:
 * desde la fila 0.214 usa {@link condicionContieneSinAcentos}). Hace falta una red y no basta con
 * revisar, porque invertir el orden NO rompe nada en una base UTF-8: el CI seguiría verde.
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

/**
 * Tabla VECINA cuyas columnas también se buscan (el proveedor dueño de una tela, su grid de
 * colores, el cliente y las referencias de una orden). Se consulta con una subconsulta NO
 * correlacionada —`t.raiz IN (SELECT v.clave FROM vecina v WHERE …)`—, y la forma es por COSTE,
 * medido dos veces:
 *
 *  - **0.205: no JOIN.** Con JOIN + `DISTINCT` la búsqueda de telas tardaba ~40 ms donde la de
 *    `EXISTS` tardaba ~15 (2,000 telas con 12,000 colores). Un JOIN devuelve el id de la raíz una vez
 *    POR FILA VECINA; el `id IN (…)` de Prisma lo deduplicaría (el resultado visible sale igual), pero
 *    la LISTA de ids crece con el grid.
 *  - **0.214: no `EXISTS` correlacionado, tampoco.** Dentro de un `OR`, Postgres no puede convertir el
 *    `EXISTS` en semi-join y lo evalúa FILA POR FILA de la raíz; el `IN` sin correlación lo resuelve
 *    UNA vez y lo consulta con un hash (*hashed SubPlan*). **Medido el 6-oct-2026, 7 corridas por
 *    caso, Postgres 16, base `C`, datos sintéticos, con el patrón escapado en SQL de
 *    {@link patronSql}:** en **órdenes** (20,000 de una empresa + 5,000 de otra, 75,000 referencias,
 *    5,400 modelos, 300 clientes) el `EXISTS` tarda **236-327 ms** y el `IN` **45-68 ms**. Donde la
 *    raíz es chica NO hay diferencia que medir: **telas** (2,000 telas, 12,000 colores, 400
 *    proveedores) 12-24 ms con `IN` contra 13-20 ms con `EXISTS`, y el Centro (dos vecinas) 41-80
 *    contra 49-91. Se usa `IN` en todas por uniformidad, no porque cada una lo necesite. Tampoco
 *    multiplica la raíz: el `IN` filtra, no junta.
 */
interface VecinoBuscable {
  /** Tabla vecina con su alias, siempre `v`. */
  tabla: string;
  /** Columna de la RAÍZ que liga con la vecina (`t.id_modelo`, o `t.id` si la vecina apunta a ella). */
  raiz: string;
  /** Columna de la VECINA que se compara con `raiz` (`v.id`, o `v.id_orden` si apunta a la raíz). */
  clave: string;
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
  /**
   * Columna de EMPRESA de la raíz (A9), calificada con `t.`. Si la tabla la tiene, el pre-filtro
   * EXIGE `idEmpresa` y sólo devuelve ids de esa empresa. No es la única reja —el `where` de Prisma
   * con el que se compone la lista sigue filtrando por empresa—, pero es la que mantiene la lista
   * del tamaño de UNA empresa (ver «El techo de la lista de ids» en la cabecera) y la que impide que
   * un llamador nuevo que olvide el `idEmpresa` del `where` vea ids ajenos.
   */
  columnaEmpresa?: string;
}

/**
 * Catálogos habilitados (whitelist). Postgres NO deja parametrizar identificadores, así que
 * **ni las tablas ni las columnas ni las ligas (`raiz`/`clave`) se parametrizan**: todas salen de
 * aquí y jamás de texto del usuario. Lo único del usuario que viaja es el patrón (y el id de
 * empresa, que sale de la sesión), y viajan como VALOR.
 *
 * Las columnas son EXACTAMENTE las que cada dominio ya buscaba con `contains mode: 'insensitive'`:
 * estas filas arreglan **cómo** se compara, no **qué** se busca. Cada entrada nombra la función
 * que la usa, para que quien la toque sepa a quién afecta.
 */
const CATALOGOS_BUSCABLES = {
  // ── Fila 0.205 (y R2): los siete typeaheads de catálogo ──────────────────────────────────────
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
      { tabla: '"proveedores" v', raiz: 't.id_proveedor', clave: 'v.id', columnas: ['v.nombre'] },
      {
        tabla: '"telas_colores" v',
        raiz: 't.id',
        clave: 'v.id_tela',
        columnas: ['v.nombre', 'v.pantone'],
      },
    ],
  },

  // ── Fila 0.214: ÓRDENES (el octavo typeahead y el Centro) ────────────────────────────────────
  // `armarBusqueda` de órdenes (SelectorOrden, listado, consultas, buscador global, WIP, costos):
  // código del MODELO, nombre del CLIENTE y CUALQUIER referencia del cliente (D7). El folio y los
  // sinónimos de departamento NO van aquí: son igualdades y se quedan en el `where` de Prisma.
  orden: {
    tabla: '"ordenes" t',
    columnas: [],
    columnaEmpresa: 't.id_empresa',
    vecinos: [
      { tabla: '"modelos" v', raiz: 't.id_modelo', clave: 'v.id', columnas: ['v.codigo'] },
      { tabla: '"clientes" v', raiz: 't.id_cliente', clave: 'v.id', columnas: ['v.nombre'] },
      { tabla: '"orden_referencia" v', raiz: 't.id', clave: 'v.id_orden', columnas: ['v.valor'] },
    ],
  },
  // `busquedaCentro` (Centro de Órdenes): lo mismo SIN el nombre de cliente (para eso está su
  // select). Ahí viven los departamentos de la OC («Niño Infantil», §Post-F9.238(b)).
  'orden-centro': {
    tabla: '"ordenes" t',
    columnas: [],
    columnaEmpresa: 't.id_empresa',
    vecinos: [
      { tabla: '"modelos" v', raiz: 't.id_modelo', clave: 'v.id', columnas: ['v.codigo'] },
      { tabla: '"orden_referencia" v', raiz: 't.id', clave: 'v.id_orden', columnas: ['v.valor'] },
    ],
  },

  // ── Fila 0.214: archivo histórico de órdenes (`construirWhere`, tres cajas distintas) ────────
  'historico-orden': {
    tabla: '"historico_orden_v1" t',
    columnas: ['t.numero', 't.cliente', 't.codigo_modelo_v1', 't.empresa_v1'],
    columnaEmpresa: 't.id_empresa',
    vecinos: [
      {
        tabla: '"modelos" v',
        raiz: 't.id_modelo',
        clave: 'v.id',
        columnas: ['v.codigo', 'v.descripcion'],
      },
    ],
  },
  'historico-orden-cliente': {
    tabla: '"historico_orden_v1" t',
    columnas: ['t.cliente'],
    columnaEmpresa: 't.id_empresa',
  },
  'historico-orden-taller': {
    tabla: '"historico_orden_v1" t',
    columnas: ['t.maquilero', 't.cortadores', 't.maquileros', 't.estampadores'],
    columnaEmpresa: 't.id_empresa',
    vecinos: [
      {
        tabla: '"historico_orden_v1_proceso" v',
        raiz: 't.id',
        clave: 'v.id_orden',
        columnas: ['v.tercero'],
      },
    ],
  },

  // ── Fila 0.214: documentos con empresa (A9) ──────────────────────────────────────────────────
  proyecto: { tabla: '"proyectos" t', columnas: ['t.nombre'], columnaEmpresa: 't.id_empresa' },
  'entrada-tela': {
    tabla: '"entradas_tela" t',
    columnas: ['t.numero_documento'],
    columnaEmpresa: 't.id_empresa',
    vecinos: [
      { tabla: '"proveedores" v', raiz: 't.id_proveedor', clave: 'v.id', columnas: ['v.nombre'] },
    ],
  },
  'partida-tela': {
    tabla: '"partidas_tela" t',
    columnas: ['t.lote_proveedor', 't.factura'],
    columnaEmpresa: 't.id_empresa',
  },

  // ── Fila 0.214: catálogos y libretas con caja de búsqueda ────────────────────────────────────
  // `galeriaArte`: el arte por su descripción/posición O por el modelo al que pertenece.
  'modelo-arte': {
    tabla: '"modelo_arte" t',
    columnas: ['t.descripcion', 't.posicion'],
    vecinos: [
      {
        tabla: '"modelos" v',
        raiz: 't.id_modelo',
        clave: 'v.id',
        columnas: ['v.codigo', 'v.descripcion'],
      },
    ],
  },
  // `listarDirectorioTerceros`: la caja libre (incluye TELÉFONO) y el filtro por servicio.
  'directorio-tercero': {
    tabla: '"directorio_tercero_v1" t',
    columnas: ['t.nombre', 't.corto', 't.razon_social', 't.contacto', 't.telefono'],
  },
  'directorio-tercero-servicio': {
    tabla: '"directorio_tercero_v1" t',
    columnas: ['t.servicios'],
  },
  // `sinonimosDeDepartamentos`: la SEMILLA del grupo de fusión («nino» → «Niño Infantil»).
  'cliente-departamento': { tabla: '"cliente_departamento" t', columnas: ['t.nombre'] },
  // `listarAlmacenes` (la empresa la pone su `where`: los globales también se listan).
  almacen: { tabla: '"almacenes" t', columnas: ['t.nombre'] },
  usuario: { tabla: '"usuarios" t', columnas: ['t.username', 't.nombre'] },
  auditor: { tabla: '"auditores" t', columnas: ['t.nombre'] },
  defecto: { tabla: '"defectos_catalogo" t', columnas: ['t.clave', 't.descripcion'] },
  'plan-aql': { tabla: '"planes_muestreo_aql" t', columnas: ['t.nombre'] },
  'tipo-producto': { tabla: '"tipos_producto" t', columnas: ['t.nombre'] },
  'concepto-pago': { tabla: '"concepto_pago" t', columnas: ['t.nombre'] },
  'direccion-entrega': {
    tabla: '"direcciones_entrega" t',
    columnas: ['t.nombre', 't.direccion'],
  },
  'etiqueta-marca': { tabla: '"etiquetas_marca" t', columnas: ['t.nombre'] },
  talla: { tabla: '"tallas" t', columnas: ['t.etiqueta'] },
  'curva-talla': { tabla: '"curvas_talla" t', columnas: ['t.nombre'] },
  'tela-categoria': { tabla: '"telas_categorias" t', columnas: ['t.nombre'] },
  'composicion-tela': { tabla: '"composiciones_tela" t', columnas: ['t.nombre'] },
  temporada: { tabla: '"temporadas" t', columnas: ['t.nombre'] },
  'concepto-costo': { tabla: '"concepto_costo" t', columnas: ['t.codigo', 't.nombre'] },
  'estado-lista': { tabla: '"estado_lista" t', columnas: ['t.codigo', 't.nombre'] },
  'personal-area': { tabla: '"personal_area" t', columnas: ['t.nombre'] },
  'actividad-productividad': { tabla: '"actividad_productividad" t', columnas: ['t.nombre'] },
  'tipo-proceso': { tabla: '"tipos_proceso" t', columnas: ['t.codigo', 't.nombre'] },
  'proceso-def': { tabla: '"proceso_def" t', columnas: ['t.codigo', 't.nombre'] },
} as const satisfies Record<string, CatalogoDefinicion>;

/** Catálogo con búsqueda de texto sin acentos. */
export type CatalogoBuscable = keyof typeof CATALOGOS_BUSCABLES;

/** Todos los catálogos habilitados (para las pruebas que barren la whitelist entera). */
export const CATALOGOS_HABILITADOS = Object.keys(CATALOGOS_BUSCABLES) as CatalogoBuscable[];

/**
 * Tipo del `id` que devuelve cada catálogo: todos son `Int`… salvo `usuarios`, cuyo id es el
 * `String` de better-auth.
 */
export type IdDeCatalogo<C extends CatalogoBuscable> = C extends 'usuario' ? string : number;

/** ¿El catálogo se acota por empresa (A9) dentro del propio pre-filtro? */
export function catalogoConEmpresa(catalogo: CatalogoBuscable): boolean {
  const definicion: CatalogoDefinicion = CATALOGOS_BUSCABLES[catalogo];
  return definicion.columnaEmpresa !== undefined;
}

/** Opciones del pre-filtro. */
export interface OpcionesBusquedaSinAcentos {
  /**
   * Empresa activa (A9). OBLIGATORIA en los catálogos con `columnaEmpresa` y PROHIBIDA en los
   * demás: en los dos casos el error es de programación, y se prefiere un tronido inmediato a una
   * búsqueda que en silencio no filtra lo que el llamador cree que filtra.
   */
  idEmpresa?: number;
}

/**
 * El PATRÓN de LIKE armado EN SQL a partir del texto CRUDO del usuario: `%` + lo tecleado sin acentos
 * ni mayúsculas, con sus comodines escapados + `%`, con la barra invertida como carácter de escape.
 *
 * 🔴 **El escape va DESPUÉS de `unaccent`, en SQL, y no antes en JavaScript.** Así era al principio
 * (el texto se escapaba en JS y ya escapado entraba a `lower(unaccent(…))`), y el reviewer de la
 * fila 0.214 lo rompió con un solo carácter: `unaccent.rules` también PLIEGA los comodines de ancho
 * completo y sus parientes —`％`→`%`, `﹪`→`%`, `＿`→`_`, `＼`/`﹨`/`∖`→ barra—, así que un `％`
 * tecleado pasaba el escape de JS intacto y `unaccent` lo convertía en un `%` VIVO. Medido: buscar
 * `100％` encontraba «ROJO 1000 CEREZA». Escapar sobre lo que `unaccent` ya devolvió cierra la puerta
 * para cualquier carácter que el diccionario pliegue hacia un comodín, hoy o en una versión futura.
 *
 * El orden de los `replace` importa: primero la barra (si no, se escaparían las barras que añaden los
 * otros dos). `standard_conforming_strings` está encendido desde Postgres 9.1, así que el literal de
 * una sola barra es UNA barra.
 */
function patronSql(busqueda: string): Prisma.Sql {
  return Prisma.sql`('%' || replace(replace(replace(lower(unaccent(${busqueda})), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')`;
}

/**
 * Una comparación «esta columna CONTIENE el texto, sin acentos ni mayúsculas»: `lower(unaccent())`
 * en AMBOS lados. Tres cosas que no se pueden tocar:
 *  - **En los dos lados.** Quitarlo de uno solo deja la búsqueda funcionando para el caso fácil
 *    (texto sin acentos contra valor sin acentos) y rota justo en el caso con acento.
 *  - **En ESE orden.** `unaccent` por fuera de `lower` ata la búsqueda al `LC_CTYPE` del servidor;
 *    la cabecera de este archivo lo explica con la medición.
 *  - **El escape de comodines, DESPUÉS de `unaccent`** ({@link patronSql}).
 *
 * El `COALESCE` no protege de nada: en una columna NULL la comparación da NULL, que en un `OR` deja
 * la fila fuera exactamente igual. Está por simetría entre todas las comparaciones, punto.
 */
function comparacion(columna: string, busqueda: string): Prisma.Sql {
  return Prisma.sql`lower(unaccent(COALESCE(${Prisma.raw(columna)}, ''))) LIKE ${patronSql(busqueda)} ESCAPE '\\'`;
}

/**
 * Condición SQL suelta «`columna` CONTIENE `busqueda`, sin acentos ni mayúsculas», para el SQL
 * crudo que arma su propio `WHERE` (fila 0.214: concentrado RC, ventas, existencias de tela, las
 * bandejas de recetas/metas, los candidatos de desarrollo). Es la MISMA comparación del pre-filtro:
 * `lower(unaccent())` en los dos lados, en el mismo orden, y los comodines del usuario escapados
 * después de `unaccent`.
 *
 * 🔴 `columna` va CRUDA al SQL (Postgres no parametriza identificadores): **sólo literales del
 * código** (`'c."nombre"'`), jamás texto que venga de la petición. Lo del usuario es `busqueda`, y
 * ése viaja CRUDO como parámetro (el escape lo hace el SQL).
 */
export function condicionContieneSinAcentos(columna: string, busqueda: string): Prisma.Sql {
  return comparacion(columna, busqueda);
}

/**
 * SQL del pre-filtro: los ids del catálogo en los que ALGUNA de sus columnas buscables —propias o
 * de una tabla vecina— contiene `busqueda`, ignorando acentos y mayúsculas (`lower(unaccent())`,
 * en ese orden: ver la cabecera). El texto viaja PARAMETRIZADO —nunca interpolado— y CRUDO: sus
 * comodines los escapa el propio SQL, después de `unaccent` ({@link patronSql}). En los catálogos
 * con empresa, la empresa también viaja como parámetro y se exige.
 *
 * Se exporta APARTE de la consulta para poder verificar su forma sin base de datos (que el texto
 * del usuario sea un parámetro y no parte del SQL es la garantía de seguridad de este módulo).
 */
export function sqlIdsPorTextoSinAcentos(
  catalogo: CatalogoBuscable,
  busqueda: string,
  opciones: OpcionesBusquedaSinAcentos = {},
): Prisma.Sql {
  const definicion: CatalogoDefinicion = CATALOGOS_BUSCABLES[catalogo];
  const { tabla, columnas, vecinos = [], columnaEmpresa } = definicion;
  const condiciones: Prisma.Sql[] = columnas.map((columna) => comparacion(columna, busqueda));
  for (const vecino of vecinos) {
    const suyas = Prisma.join(
      vecino.columnas.map((columna) => comparacion(columna, busqueda)),
      ' OR ',
    );
    condiciones.push(
      Prisma.sql`${Prisma.raw(vecino.raiz)} IN (SELECT ${Prisma.raw(vecino.clave)} FROM ${Prisma.raw(
        vecino.tabla,
      )} WHERE ${suyas})`,
    );
  }
  const texto = Prisma.join(condiciones, ' OR ');

  if (columnaEmpresa === undefined) {
    if (opciones.idEmpresa !== undefined) {
      throw new Error(
        `La búsqueda de «${catalogo}» no se acota por empresa: no le pases idEmpresa (A9 la pone el where del dominio).`,
      );
    }
    return Prisma.sql`SELECT t.id FROM ${Prisma.raw(tabla)} WHERE ${texto}`;
  }
  if (opciones.idEmpresa === undefined) {
    throw new Error(`La búsqueda de «${catalogo}» exige idEmpresa (A9).`);
  }
  return Prisma.sql`SELECT t.id FROM ${Prisma.raw(tabla)} WHERE ${Prisma.raw(
    columnaEmpresa,
  )} = ${opciones.idEmpresa} AND (${texto})`;
}

/**
 * IDs del catálogo que coinciden con `busqueda` sin acentos ni mayúsculas. Devuelve la lista para
 * componer `id: { in: ids }` con el resto del filtro Prisma — lista vacía = ninguna coincidencia
 * (la página sale vacía sola). Cada id aparece UNA vez: los vecinos van por `IN (subconsulta)`,
 * que filtra la fila raíz sin multiplicarla.
 */
export async function idsPorTextoSinAcentos<C extends CatalogoBuscable>(
  cliente: Tx | PrismaClient,
  catalogo: C,
  busqueda: string,
  opciones: OpcionesBusquedaSinAcentos = {},
): Promise<IdDeCatalogo<C>[]> {
  const filas = await cliente.$queryRaw<{ id: IdDeCatalogo<C> }[]>(
    sqlIdsPorTextoSinAcentos(catalogo, busqueda, opciones),
  );
  return filas.map((fila) => fila.id);
}

/**
 * {@link idsPorTextoSinAcentos} para la forma más común en el dominio: una caja de búsqueda
 * OPCIONAL. Sin texto (`undefined` o `''`) devuelve `undefined` —«no hay búsqueda, no filtres»— sin
 * tocar la base; con texto, la lista de ids (vacía = nada casa). La diferencia entre las dos cosas
 * es la que hay entre no filtrar y filtrar a cero, y por eso no se representa con un `[]`.
 */
export async function idsSiHayBusqueda<C extends CatalogoBuscable>(
  cliente: Tx | PrismaClient,
  catalogo: C,
  busqueda: string | undefined,
  opciones: OpcionesBusquedaSinAcentos = {},
): Promise<IdDeCatalogo<C>[] | undefined> {
  if (busqueda === undefined || busqueda === '') {
    return undefined;
  }
  return idsPorTextoSinAcentos(cliente, catalogo, busqueda, opciones);
}
