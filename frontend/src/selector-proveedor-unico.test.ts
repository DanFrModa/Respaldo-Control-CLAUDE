import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * EL CANDADO CONTRA LA QUINTA VEZ.
 *
 * Daniel ha reportado el MISMO defecto cuatro veces (§Post-F9.52 punto 7): «el proveedor no busca
 * por todas sus palabras, busca sólo por orden alfabético». Se arregló en el BOM (V1-E3c), en las
 * doce pantallas de cliente (V1-E4), en el arte (V1-E3f) y en la OC independiente (V1-E7g), y las
 * tres primeras veces NO viajó al resto de la app. Ya en la tercera quedó escrito «barrer TODOS los
 * `SelectNativo` de proveedor que queden»; no se barrieron, y volvió.
 *
 * La causa nunca estuvo en el servidor: `idsPorNombreSinAcentos` hace `LIKE %texto%` sin acentos y
 * casa EN MEDIO del nombre. Está en la pantalla: el «buscar tecleando» de un `<select>` nativo es
 * el typeahead del NAVEGADOR, que pega únicamente por PREFIJO. Y encima esas pantallas alimentaban
 * el `<select>` con `porPagina: 100` —el tope del contrato de paginación—, así que con ~1,700
 * proveedores reales la mayoría ni siquiera estaba en la lista.
 *
 * ⚠️ **Por qué existe esta prueba y no basta con «acordarse».** Cuatro reincidencias dicen que la
 * memoria no sostiene la regla. Ésta la sostiene: si alguien agrega un `<SelectNativo>` que se
 * alimenta de una lista de proveedores/maquileros/cortadores, esta prueba se pone ROJA y le dice
 * cuál es el componente que sí debe usar.
 *
 * ⚠️ **Su alcance, dicho sin adornos.** Reconoce la fuente de las opciones por el NOMBRE de la
 * variable que se recorre (`proveedores.map`, `maquileros.map`, `listaCortadores.map`…). Es el
 * mismo criterio con el que se encontraron las once pantallas de V1-E7g y no dejó ninguna fuera,
 * pero NO es infalible: un `<select>` alimentado por una variable llamada `terceros` o `surtidores`
 * se le escaparía. Es una red, no una demostración — y una red vale mucho más que la memoria de la
 * siguiente persona.
 *
 * Vive en `tsconfig.node.json` (no en el proyecto de la app) porque lee archivos REALES del disco
 * con `node:fs`, igual que `version.test.ts` y `abreviatura-e2e.test.ts`.
 */

/** Sube desde el cwd hasta toparse con `PLANMAESTRO.md`, el marcador estable de la raíz. */
function raizDelRepo(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'PLANMAESTRO.md'))) {
      return dir;
    }
    const padre = dirname(dir);
    if (padre === dir) {
      break;
    }
    dir = padre;
  }
  throw new Error('No se encontró la raíz del repo (PLANMAESTRO.md)');
}

/** Todos los `.tsx` de `frontend/src` (los `.test.tsx` no cuentan: no son pantallas). */
function pantallas(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return pantallas(ruta);
    }
    return entrada.name.endsWith('.tsx') && !entrada.name.endsWith('.test.tsx') ? [ruta] : [];
  });
}

/**
 * Nombres de variable que delatan una lista de TERCEROS del catálogo. Se buscan entre los
 * IDENTIFICADORES de la expresión que se recorre con `.map(` dentro del `<SelectNativo>`.
 *
 * Los identificadores EN MAYÚSCULAS quedan fuera a propósito (`MONEDAS_PROVEEDOR`,
 * `TIPOS_ARCHIVO_PROVEEDOR`): una constante del módulo nunca es un catálogo paginado — es una
 * lista fija de tres o cuatro opciones que un combobox con búsqueda sólo estorbaría.
 */
const DELATORES = /proveedor|maquiler|cortador|taller/i;
const CONSTANTE = /^[A-Z0-9_]+$/;
/**
 * Palabras de PLOMERÍA que envuelven a la lista de verdad y hay que atravesar para llegar a su
 * nombre: `(proveedores.data?.datos ?? []).map(…)` se recorre en `datos`, pero quien manda es
 * `proveedores`.
 */
const PLOMERIA = new Set(['data', 'datos', 'filas', 'items', 'lista', 'value']);

/**
 * EXCEPCIONES JUSTIFICADAS: `<SelectNativo>` que sí listan terceros pero NO son el defecto, porque
 * NO recorren el catálogo — ofrecen un puñado de opciones ya acotadas por el dato de la pantalla.
 * Un combobox con búsqueda en servidor ahí no arreglaría nada (no hay nada que buscar) y estorbaría.
 *
 * Agregar una entrada aquí es una DECISIÓN, no un trámite: exige la razón por escrito.
 */
const EXCEPCIONES: { archivo: string; fuente: string; razon: string }[] = [
  {
    archivo: 'src/modulos/ordenes-compra/EditorLineasOc.tsx',
    fuente: 'proveedores',
    razon:
      'Son los proveedores DEL AVÍO del renglón (con su precio R1), no el catálogo: uno a tres ' +
      'opciones que ya vienen dentro del avío elegido. No hay catálogo que buscar.',
  },
  {
    archivo: 'src/modulos/calidad/AltaAuditoriaPagina.tsx',
    fuente: 'maquileros',
    razon:
      'Son los maquileros DE ESA ORDEN (los que tienen envíos/recibos en ella), que el servidor ' +
      'manda ya resueltos con su sugerido. Es una lista de dos o tres, no el catálogo.',
  },
];

/** Un `<SelectNativo>` sospechoso: dónde está y de qué lista se alimenta. */
interface Hallazgo {
  archivo: string;
  linea: number;
  fuente: string;
}

/** Recorre un archivo y devuelve sus `<SelectNativo>` alimentados por una lista de terceros. */
function sospechosos(rutaAbsoluta: string, raiz: string): Hallazgo[] {
  const texto = readFileSync(rutaAbsoluta, 'utf-8');
  const archivo = relative(join(raiz, 'frontend'), rutaAbsoluta).replaceAll('\\', '/');
  const hallazgos: Hallazgo[] = [];
  // Bloques `<SelectNativo …>…</SelectNativo>` (no perezoso a propósito: el `?` corta en el
  // primer cierre, que es el del propio bloque porque estos selects nunca se anidan).
  for (const bloque of texto.matchAll(/<SelectNativo\b[\s\S]*?<\/SelectNativo>/g)) {
    const cuerpo = bloque[0];
    for (const recorrido of cuerpo.matchAll(/\.map\(/g)) {
      // La expresión que se recorre vive JUSTO ANTES del `.map(`. Se mira una ventana en vez de
      // parsearla porque en la vida real no es un identificador limpio: hay `?.`, `?? []` y hasta
      // un `.find(...)` de por medio (`avios.find((a) => …)?.proveedores ?? []`).
      const ventana = cuerpo.slice(Math.max(0, recorrido.index - 120), recorrido.index);
      const tokens = [...ventana.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)].map((token) => token[0]);
      // El nombre de la lista es el ÚLTIMO identificador antes del `.map(`, saltándose la
      // plomería. Mirar sólo ése (y no «cualquier palabra de la ventana») evita confundirse con
      // un tipo citado en el `onChange` de más arriba, que no es la fuente de nada.
      while (tokens.length > 0 && PLOMERIA.has(tokens[tokens.length - 1] ?? '')) {
        tokens.pop();
      }
      const fuente = tokens.at(-1);
      const delator =
        fuente !== undefined && !CONSTANTE.test(fuente) && DELATORES.test(fuente)
          ? fuente
          : undefined;
      if (delator !== undefined) {
        hallazgos.push({
          archivo,
          linea: texto.slice(0, bloque.index).split('\n').length,
          fuente: delator,
        });
      }
    }
  }
  return hallazgos;
}

describe('El proveedor se elige SIEMPRE con el combobox buscable (§Post-F9.52 punto 7)', () => {
  const raiz = raizDelRepo();
  const src = join(raiz, 'frontend', 'src');

  it('ningún `<SelectNativo>` se alimenta del catálogo de proveedores/maquileros/cortadores', () => {
    const hallazgos = pantallas(src)
      .flatMap((archivo) => sospechosos(archivo, raiz))
      .filter(
        (h) =>
          !EXCEPCIONES.some(
            (excepcion) => excepcion.archivo === h.archivo && excepcion.fuente === h.fuente,
          ),
      );

    expect(
      hallazgos.map((h) => `${h.archivo}:${h.linea} (se alimenta de \`${h.fuente}\`)`),
      'Un `<select>` nativo sólo deja BUSCAR POR PREFIJO (typeahead del navegador) y encima topa ' +
        'en 100 proveedores: es el defecto que Daniel ya reportó cuatro veces. Usa ' +
        '`SelectorProveedor` (captura) o `FiltroProveedor` (filtro de listado), que buscan en el ' +
        'SERVIDOR. Si de verdad NO es el catálogo sino una lista corta ya acotada, agrégalo a ' +
        'EXCEPCIONES con su razón por escrito.',
    ).toEqual([]);
  });

  it('las EXCEPCIONES declaradas siguen existiendo (si se borran, la lista se limpia)', () => {
    // Una excepción que ya no corresponde a nada es basura que tapa defectos futuros: si mañana
    // alguien reescribe esa pantalla, la entrada muerta perdonaría a un `<select>` nuevo.
    const vivos = pantallas(src).flatMap((archivo) => sospechosos(archivo, raiz));
    for (const excepcion of EXCEPCIONES) {
      expect(
        vivos.some((h) => h.archivo === excepcion.archivo && h.fuente === excepcion.fuente),
        `La excepción ${excepcion.archivo} (\`${excepcion.fuente}\`) ya no corresponde a ningún ` +
          '`<SelectNativo>`: bórrala de EXCEPCIONES.',
      ).toBe(true);
    }
  });
});
