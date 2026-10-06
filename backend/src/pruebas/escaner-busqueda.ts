/**
 * ⭐⭐ EL ESCÁNER DE LA RED «NINGÚN SITIO 34» (fila 0.214) — vive aparte de su prueba
 * (`src/comun/busqueda-guardian.test.ts`) por la misma razón que `eco-sin-reja.ts`: así se puede
 * correr también FUERA de Vitest, contra otro árbol (p. ej. el de `origin/prueba` antes de la fila),
 * para comprobar que cuenta lo mismo que el censo publicado (48 ocurrencias · 33 funciones · 30
 * archivos).
 *
 * **Qué busca:** cada `mode: 'insensitive'` de Prisma que vaya en un filtro `contains` (ILIKE:
 * ignora mayúsculas pero NO acentos), y cada `ILIKE` escrito a mano en SQL crudo. Los `equals` con
 * `mode: 'insensitive'` NO cuentan, a propósito: son comparaciones de identidad, no búsqueda.
 *
 * 🔴 **Cómo decide a qué filtro pertenece un `mode`: por el OBJETO `{…}` que lo encierra, mirando sus
 * claves a LOS DOS LADOS.** La primera versión buscaba la clave más cercana HACIA ATRÁS, y el
 * reviewer de la fila la tumbó con una mutación de una línea: `{ nombre: { mode: 'insensitive',
 * contains: x } }` —el mismo filtro, con las claves en otro orden— pasaba en verde, porque hacia
 * atrás lo más cercano era el `in:` de otra expresión. Prisma acepta las claves en cualquier orden,
 * así que el escáner también tiene que hacerlo.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Los `.ts` de CÓDIGO bajo un directorio: sin pruebas, sin `node_modules` ni el cliente generado. */
export function fuentesDeCodigo(directorio: string): string[] {
  if (!existsSync(directorio)) return [];
  const salida: string[] = [];
  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules' || entrada.name === 'generated') continue;
      salida.push(...fuentesDeCodigo(ruta));
    } else if (entrada.name.endsWith('.ts') && !entrada.name.endsWith('.test.ts')) {
      salida.push(ruta);
    }
  }
  return salida;
}

/** El modo de Prisma que se vigila (con `\s*` para no casarse consigo mismo en este archivo). */
const MODO_INSENSIBLE = /mode:\s*'insensitive'/g;

/** Las claves de filtro de texto de Prisma, en orden de PRIORIDAD: `contains` gana a todas. */
export const CLAVES_DE_FILTRO = ['contains', 'startsWith', 'endsWith', 'equals', 'in'] as const;
export type ClaveDeFiltro = (typeof CLAVES_DE_FILTRO)[number];

/** `ILIKE`, armado en trozos para no aparecer tal cual en este archivo. */
const OPERADOR_SQL_INSENSIBLE = new RegExp(`\\b${'IL'}IKE\\b`, 'i');

/** ¿La línea (o el arranque de línea) es de comentario? */
export function esComentario(linea: string): boolean {
  const limpia = linea.trim();
  return ['*', '//', '/*'].some((prefijo) => limpia.startsWith(prefijo));
}

/** Una ocurrencia de `mode: 'insensitive'` con la clave de filtro que la gobierna. */
export interface Ocurrencia {
  ruta: string;
  linea: number;
  clave: ClaveDeFiltro | null;
}

/**
 * El texto del objeto `{…}` que encierra la posición `indice`, SÓLO en su primer nivel: lo que va
 * dentro de llaves anidadas se descarta (sus claves son de otro objeto). `null` si no hay objeto que
 * lo encierre.
 */
function primerNivelDelObjeto(fuente: string, indice: number): string | null {
  let inicio = -1;
  for (let i = indice - 1, profundidad = 0; i >= 0; i--) {
    const caracter = fuente[i];
    if (caracter === '}') profundidad++;
    else if (caracter === '{') {
      if (profundidad === 0) {
        inicio = i;
        break;
      }
      profundidad--;
    }
  }
  if (inicio === -1) return null;

  let texto = '';
  for (let i = inicio + 1, profundidad = 0; i < fuente.length; i++) {
    const caracter = fuente[i];
    if (caracter === '{') profundidad++;
    else if (caracter === '}') {
      if (profundidad === 0) return texto;
      profundidad--;
    } else if (profundidad === 0) {
      texto += caracter;
    }
  }
  return null;
}

/**
 * Para cada `mode: 'insensitive'` de CÓDIGO del texto, la clave de filtro del objeto que lo encierra
 * (a los dos lados del `mode`, en cualquier orden; si hubiera varias, gana `contains`). Las líneas
 * de comentario que nombran el modo no cuentan.
 */
export function ocurrencias(ruta: string, fuente: string): Ocurrencia[] {
  const salida: Ocurrencia[] = [];
  for (const coincidencia of fuente.matchAll(MODO_INSENSIBLE)) {
    const antes = fuente.slice(0, coincidencia.index);
    if (esComentario(antes.slice(antes.lastIndexOf('\n') + 1))) continue;
    const objeto = primerNivelDelObjeto(fuente, coincidencia.index);
    const clave =
      objeto === null
        ? null
        : (CLAVES_DE_FILTRO.find((candidata) => new RegExp(`\\b${candidata}\\s*:`).test(objeto)) ??
          null);
    salida.push({ ruta, linea: antes.split('\n').length, clave });
  }
  return salida;
}

/** Líneas de CÓDIGO (no de comentario) que usan `ILIKE` a mano, como `ruta:línea`. */
export function ilikesACodigo(ruta: string, fuente: string): string[] {
  return fuente
    .split('\n')
    .map((linea, i) => ({ linea, numero: i + 1 }))
    .filter(({ linea }) => !esComentario(linea))
    .filter(({ linea }) => OPERADOR_SQL_INSENSIBLE.test(linea))
    .map(({ numero }) => `${ruta}:${numero}`);
}
