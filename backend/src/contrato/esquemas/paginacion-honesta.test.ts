import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { esquemaPaginacion } from '../../comun/paginacion.js';
import { esquemaListarAviosDominio } from '../../dominio/catalogos/avios.js';
import { esquemaListarProveedores } from '../../dominio/catalogos/proveedores.js';
import { esquemaListarTelas as esquemaListarTelasDominio } from '../../dominio/catalogos/telas.js';
import { esquemaConsultaOrdenesDominio } from '../../dominio/produccion/consultas.js';
import { esquemaListarAvios } from './avio.js';
import { esquemaConsultaOrdenes } from './orden-consulta.js';
import { esquemaProveedoresQuery } from './proveedor.js';
import { esquemaListarTelas as esquemaListarTelasContrato } from './tela.js';

/**
 * ⭐ EL CONTRATO NO PUEDE PROMETER UNA PÁGINA QUE EL DOMINIO RECHAZA (fila 0.083).
 *
 * En esta arquitectura el OpenAPI es lo ÚNICO compartido entre backend y frontend: si el
 * querystring publica `porPagina ≤ 500` y el servicio re-valida con `esquemaPaginacion`
 * (tope 100), pedir 500 no trae 500 renglones — trae un **400**. El contrato miente y nadie
 * se entera hasta que un cliente le cree.
 *
 * CÓMO NACIÓ EL DEFECTO: alguien subió el tope a 500 en cuatro listados de catálogo "para que
 * los dropdowns carguen todo el catálogo". Los cuatro dominios re-validan con
 * `esquemaPaginacion`, así que **el arreglo nunca funcionó en ninguno** — pero las pruebas que
 * lo respaldaban interrogaban SÓLO al esquema del contrato, jamás al dominio, y salían verdes
 * con la función rota. Es la trampa de la RAMA GEMELA: dos caminos simétricos, se toca uno y se
 * prueba el otro. Y no fue una vez: `color.ts` cayó en lo mismo y se arregló aparte (f40ddf33).
 * **Cinco reincidencias ⇒ hay que cerrar la CLASE, no el caso.**
 *
 * Por eso este archivo vigila en DOS niveles:
 *  1. **Los cuatro pares contrato↔dominio**, comparados contra el esquema de dominio REAL — no
 *     contra un intermediario que "debería" ser equivalente (ver la nota de abajo).
 *  2. **Un barrido de TODO `contrato/esquemas/`**, para que un endpoint que nazca mañana quede
 *     cubierto *por omisión* en vez de tener que acordarse de añadirlo a una lista blanca.
 *
 * ⚠️ NOTA DE UNA VERSIÓN ANTERIOR DE ESTA PRUEBA, que vale como advertencia: las filas de avíos
 * y órdenes comparaban contra `esquemaPaginacion` en vez de contra su esquema de dominio, porque
 * éstos eran module-private, y una prueba por texto "garantizaba" la equivalencia mirando que
 * siguieran siendo `esquemaPaginacion.extend({...})`. **Era un guardián ciego:** bastaba dejar esa
 * línea intacta y meter `porPagina: z.number().max(50)` DENTRO del `extend` para resucitar el
 * defecto entero con las 6 pruebas en verde. Por eso hoy los dominios se exportan y se comparan
 * directo: contra el objeto que de verdad valida, nunca contra uno que se le parece.
 */

/** Hasta dónde busca el tope. Muy por encima de cualquier página real: un esquema SIN `.max()` se
 *  delata devolviendo este número en vez de un tope creíble. */
const TOPE_BUSQUEDA = 100_000;

/**
 * Tope REAL de `porPagina`, descubierto por búsqueda binaria en vez de leerlo del código:
 * `porPagina` es monótono (si acepta `n`, acepta `n-1`), así que el corte es único.
 * **Descubrirlo —en lugar de afirmarlo— es lo que impide que la prueba se quede pegada al número
 * viejo cuando alguien mueve el esquema**, y lo que la vuelve una comparación entre los dos lados
 * y no una copia del literal.
 */
function topeAceptado(acepta: (n: number) => boolean): number {
  let bajo = 1;
  let alto = TOPE_BUSQUEDA;
  if (!acepta(bajo)) return 0;
  while (bajo < alto) {
    const medio = Math.ceil((bajo + alto) / 2);
    if (acepta(medio)) bajo = medio;
    else alto = medio - 1;
  }
  return bajo;
}

/** Esquema del que sólo interesa si acepta o no un valor. */
type Validable = { safeParse: (valor: unknown) => { success: boolean } };

const porQuerystring = (e: Validable) => (n: number) => e.safeParse({ porPagina: n }).success;

/** Los cuatro listados que llevaban el tope inflado, cada uno con el esquema con el que su
 *  servicio de dominio re-valida lo que la ruta le pasa. */
const listados = [
  { nombre: 'avíos', contrato: esquemaListarAvios, dominio: esquemaListarAviosDominio },
  { nombre: 'telas', contrato: esquemaListarTelasContrato, dominio: esquemaListarTelasDominio },
  { nombre: 'proveedores', contrato: esquemaProveedoresQuery, dominio: esquemaListarProveedores },
  {
    nombre: 'consulta de órdenes',
    contrato: esquemaConsultaOrdenes,
    dominio: esquemaConsultaOrdenesDominio,
  },
] satisfies { nombre: string; contrato: Validable; dominio: Validable }[];

describe('el contrato no promete un porPagina que el dominio rechace', () => {
  it.each(listados)(
    '$nombre: el tope del querystring es el mismo que acepta su dominio',
    ({ contrato, dominio }) => {
      const topeContrato = topeAceptado(porQuerystring(contrato));
      const topeDominio = topeAceptado(porQuerystring(dominio));

      // El corazón del asunto: lo máximo que la API DICE aceptar tiene que ser algo que el
      // servicio efectivamente acepte. Si el contrato promete más, ese renglón de más es un 400.
      expect(dominio.safeParse({ porPagina: topeContrato }).success).toBe(true);
      expect(topeContrato).toBe(topeDominio);
    },
  );

  it('y ese tope compartido es el de esquemaPaginacion (hoy 100)', () => {
    // Ancla el número UNA sola vez y en un solo lugar, para que la prueba de arriba siga siendo
    // una comparación entre lados y no una copia del literal.
    expect(topeAceptado(porQuerystring(esquemaPaginacion))).toBe(100);
  });
});

// ── Barrido de toda la superficie del contrato ──────────────────────────────────────────────

/**
 * `import.meta.glob` lo aporta Vite (vitest corre sobre él), pero el `tsconfig` del backend es de
 * Node y no trae sus tipos; se declaran aquí, acotados a este uso, en vez de arrastrar
 * `vite/client` entero a un proyecto de servidor que no es una app de Vite.
 *
 * ⚠️ **La llamada tiene que quedar escrita literal como `import.meta.glob(...)`.** Vite la
 * SUSTITUYE durante la transformación del archivo, así que guardarla en una variable para tipearla
 * más cómodo la rompe en tiempo de ejecución con *"import.meta.glob is statically replaced"* — y el
 * archivo entero deja de aportar pruebas (falla como suite, no como aserción). Ya pasó una vez.
 */
declare global {
  interface ImportMeta {
    glob: (
      patrones: string[],
      opciones: { eager: true },
    ) => Record<string, Record<string, unknown>>;
  }
}

/**
 * Todos los esquemas del contrato, importados de verdad (no leídos como texto). `import.meta.glob`
 * los descubre solo: **un archivo nuevo entra al barrido sin que nadie lo apunte en ningún lado**,
 * que es justamente lo que a una lista blanca se le escapa. Los `.test.ts` se excluyen EN EL
 * PATRÓN — importarlos aquí registraría sus pruebas dentro de este archivo.
 *
 * ⚠️ **Los patrones van RECURSIVOS (`./**\/*.ts`) a propósito, aunque hoy `esquemas/` sea plano.**
 * Con `./*.ts` un esquema mentiroso metido en un subdirectorio (`esquemas/finanzas/nuevo.ts`) salía
 * VERDE, y lo peor es por qué: la red anti-silencio de más abajo cuenta sobre
 * `Object.keys(modulosDelContrato)`, o sea **sobre este mismo glob**, así que comparaba los
 * archivos barridos contra sí mismos y **por construcción no podía ver un archivo que el glob nunca
 * miró**. Una red que se mide con la misma vara que vigila no es una red. Recursivo, el archivo
 * entra al barrido y el conteo vuelve a significar algo.
 */
const modulosDelContrato = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], { eager: true });

/**
 * Los dos listados que topan en 200 y **son honestos**: su servicio de dominio re-valida con el
 * MISMÍSIMO objeto del contrato (`validarEntrada(esquemaDirectorioTercerosQuery, …)` y
 * `validarEntrada(esquemaHistoricoOrdenesQuery, …)`), no con uno paralelo construido sobre
 * `esquemaPaginacion`. Ésa es la regla estructural que explica la fila entera:
 *
 *   **un listado es honesto ⟺ la ruta y el dominio validan con el MISMO esquema.**
 *
 * Los cuatro mentirosos tenían dos objetos distintos; estos dos tienen uno solo, y por eso pueden
 * ofrecer 200 sin mentir. Si alguno dejara de compartir el objeto, tendría que salir de aquí.
 */
const EXCEPCIONES_JUSTIFICADAS = new Map<string, number>([
  ['./directorio-terceros.ts#esquemaDirectorioTercerosQuery', 200],
  ['./historico-ordenes.ts#esquemaHistoricoOrdenesQuery', 200],
]);

/** Un `porPagina` encontrado en el contrato, ya clasificado. */
interface CampoPorPagina {
  clave: string;
  /** De ENTRADA (querystring) si trae `.default()`; las de RESPUESTA (`*Pagina`) sólo hacen eco
   *  del número que devolvió el servidor y no llevan tope que pueda mentir. */
  esEntrada: boolean;
  tope: number;
}

function recolectarPorPagina(): CampoPorPagina[] {
  const campos: CampoPorPagina[] = [];
  for (const [ruta, modulo] of Object.entries(modulosDelContrato)) {
    for (const [nombre, valor] of Object.entries(modulo)) {
      const shape = (valor as { shape?: Record<string, Validable> } | null)?.shape;
      if (!shape || !('porPagina' in shape)) continue;
      const campo = shape.porPagina;
      campos.push({
        clave: `${ruta}#${nombre}`,
        esEntrada: campo.safeParse(undefined).success,
        tope: topeAceptado((n) => campo.safeParse(n).success),
      });
    }
  }
  return campos;
}

describe('barrido: ningún esquema de entrada del contrato promete más que el tope compartido', () => {
  const campos = recolectarPorPagina();
  const topeCompartido = topeAceptado(porQuerystring(esquemaPaginacion));

  it('todo porPagina de entrada topa en el compartido, salvo las excepciones justificadas', () => {
    const infractores = campos
      .filter((c) => c.esEntrada)
      .filter((c) => c.tope !== (EXCEPCIONES_JUSTIFICADAS.get(c.clave) ?? topeCompartido))
      .map((c) => `${c.clave} topa en ${c.tope}`);

    // Se comparan LISTAS (no un conteo) para que el fallo diga QUÉ endpoint miente y con qué
    // número, en vez de "esperaba 0, recibí 1".
    expect(infractores).toEqual([]);
  });

  it('las excepciones siguen siendo exactamente las dos declaradas, y siguen en 200', () => {
    // Si una excepción se arregla o desaparece, esto obliga a borrarla de la lista en vez de
    // dejarla ahí cubriendo un caso que ya no existe (una excepción zombi tapa defectos nuevos).
    const declaradas = [...EXCEPCIONES_JUSTIFICADAS].map(([clave, tope]) => `${clave}=${tope}`);
    const reales = campos
      .filter((c) => c.esEntrada && c.tope !== topeCompartido)
      .map((c) => `${c.clave}=${c.tope}`);
    expect(reales.sort()).toEqual(declaradas.sort());
  });

  it('el barrido alcanza TODOS los porPagina del contrato (nada se salta en silencio)', () => {
    // ⚠️ La red de seguridad del barrido. Un esquema envuelto (p. ej. en `.transform()`) no expone
    // `.shape` y quedaría fuera SIN QUE NADIE SE ENTERE — el mismo pecado que esta fila vino a
    // matar. Contrastar contra el conteo en fuente convierte ese silencio en rojo.
    //
    // El patrón va SIN ancla de línea a propósito: con `^\s*` sólo veía los campos escritos en su
    // propio renglón, así que un `z.object({ porPagina: … })` en una sola línea se colaba invisible
    // — un mutante real sobrevivió justo por ahí. Hoy los 114 dan igual con ancla y sin ella, así
    // que quitarla no cuesta nada y tapa el hueco.
    const enFuente = Object.keys(modulosDelContrato)
      .map((ruta) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8'))
      .reduce((suma, texto) => suma + (texto.match(/porPagina:\s*z\./g)?.length ?? 0), 0);

    expect(campos.length).toBe(enFuente);
    expect(campos.filter((c) => c.esEntrada).length).toBeGreaterThan(50);
  });
});
