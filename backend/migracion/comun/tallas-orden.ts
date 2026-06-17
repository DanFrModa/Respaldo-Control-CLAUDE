/**
 * Parsing POSICIONAL de la matriz de órdenes del sistema viejo (F2-E5, ETL).
 *
 * En el viejo, una orden tiene UNA cadena `Ordenes.Tallas` (ancho fijo de 2 chars por
 * posición; ver `comun/tallas.ts`) y N renglones `OrdenesDet` (un COLOR cada uno) con las
 * columnas FIJAS `T1..T8`. El form `OrdenesDet.Form_GotFocus` (VBA) confirma la regla:
 * cada control `Tn` corresponde POSICIONALMENTE a la talla de la ventana n de `Tallas`
 * (`T1` ↔ chars 1-2, `T2` ↔ chars 3-4, … `Tn` ↔ chars (2n-1)..(2n)). Es decir, la
 * etiqueta de cada cantidad `OrdenesDet.Tn` se LEE de la posición n de la cadena `Tallas`
 * de la orden padre — NO hay etiqueta por renglón de detalle.
 *
 * DESPIVOTE (F2-E5): por cada renglón de color y cada columna `Tn` con cantidad >0, se emite
 * un `OrdenLineaTalla(idTalla, cantidad)`, donde `idTalla` se resuelve desde la etiqueta de la
 * posición n. Las cantidades 0/vacías NO emiten fila (matriz dispersa, D4/D3).
 *
 * DOBLE CURVA (verificado en datos reales): ~18 cadenas traen un SEPARADOR de curva en alguna
 * posición — `--`, `- ` o `-`/`- ` final — que NO es talla (la orden mezcla dos curvas, p. ej.
 * `"6 1218--2 3 3X"` = curva 6/12/18 + curva 2/3/3X). Esa posición de `OrdenesDet.Tn` trae 0
 * en los datos (confirmado), así que el despivote NO la emite igual. El parser marca esas
 * posiciones como SEPARADOR (etiqueta vacía + bandera) para que el loader las salte sin perder
 * el alineamiento posicional del resto.
 *
 * El parser es PURO (sin BD): el loader resuelve cada etiqueta contra el catálogo `Talla` y
 * reporta las que no mapean (§7: nada se pierde en silencio).
 */

/** Una POSICIÓN de la cadena `Tallas` (ventana de 2 chars), ya interpretada. */
export interface PosicionTalla {
  /** Índice de columna 1..8 (T1..T8). */
  columna: number;
  /** Etiqueta de talla recortada (p. ej. "CH", "M", "12"); vacía si es separador. */
  etiqueta: string;
  /** `true` si esta posición es un SEPARADOR de curva ("--", "- ", "-"), no una talla. */
  separador: boolean;
}

/** Resultado de interpretar la cadena `Ordenes.Tallas` posición por posición. */
export interface TallasOrdenParseadas {
  /** Posiciones (una por ventana de 2), en orden. */
  posiciones: PosicionTalla[];
  /**
   * `true` si la cadena tiene algo que el despivote posicional NO sabe alinear con seguridad:
   * salto de línea, o una posición que NO es ni talla limpia ni separador conocido (p. ej.
   * "GE" de "CHM GEX", donde se perdió un espacio de relleno). El loader la LISTA para Daniel
   * pero AÚN despivota por posición (la cantidad nunca se pierde; lo dudoso es la etiqueta).
   */
  ambigua: boolean;
  /** La cadena original (para el reporte). */
  original: string;
}

/** Tokens de 2 chars que, una vez recortados, son un SEPARADOR de curva (no una talla). */
function esSeparador(par: string): boolean {
  const t = par.trim();
  return t === '' ? false : /^-+$/.test(t);
}

/**
 * Interpreta `Ordenes.Tallas` en ventanas FIJAS de 2 caracteres, asignando a cada ventana su
 * número de columna (1-based). Recorta cada par; clasifica separadores de curva (`--`/`- `/`-`).
 * Marca `ambigua` cuando una ventana de 2 chars trae contenido que NO es talla limpia ni
 * separador (p. ej. una etiqueta partida por un espacio perdido), o cuando hay salto de línea.
 *
 * NO valida contra el catálogo (eso es del loader): solo segmenta y clasifica. El despivote
 * usa `columna` para alinear con `OrdenesDet.Tn`.
 */
export function parsearTallasOrden(crudo: string): TallasOrdenParseadas {
  const original = crudo;
  if (crudo.includes('\n') || crudo.includes('\r')) {
    // Salto de línea dentro de la celda: no se puede alinear por ancho fijo con confianza.
    return { posiciones: [], ambigua: true, original };
  }

  const posiciones: PosicionTalla[] = [];
  let ambigua = false;
  let columna = 0;
  for (let i = 0; i < crudo.length; i += 2) {
    columna += 1;
    const par = crudo.slice(i, i + 2);
    if (par.length < 2 && par.trim() !== '') {
      // Carácter suelto al final (longitud impar con contenido): no respeta el ancho fijo.
      ambigua = true;
      posiciones.push({ columna, etiqueta: par.trim(), separador: false });
      continue;
    }
    const etiqueta = par.trim();
    if (etiqueta === '') {
      // Ventana de relleno (espacios): no aporta talla; tampoco rompe la alineación.
      continue;
    }
    if (esSeparador(par)) {
      posiciones.push({ columna, etiqueta: '', separador: true });
      continue;
    }
    posiciones.push({ columna, etiqueta, separador: false });
  }

  if (posiciones.length === 0) {
    ambigua = true;
  }
  return { posiciones, ambigua, original };
}

/**
 * Mapa `columna (1..8) → etiqueta de talla` para una orden, a partir de su cadena `Tallas`.
 * Las posiciones separador y las vacías NO entran (su columna devuelve `undefined`), así el
 * despivote sabe que esa `Tn` no corresponde a una talla real (su cantidad debe ser 0).
 *
 * Devuelve también la bandera `ambigua` para que el loader la liste.
 */
export interface MapaColumnasTalla {
  /** columna 1..8 → etiqueta (solo posiciones que son talla real). */
  porColumna: Map<number, string>;
  ambigua: boolean;
  original: string;
}

export function mapaColumnasTalla(crudo: string): MapaColumnasTalla {
  const parsed = parsearTallasOrden(crudo);
  const porColumna = new Map<number, string>();
  for (const p of parsed.posiciones) {
    if (!p.separador && p.etiqueta !== '') {
      porColumna.set(p.columna, p.etiqueta);
    }
  }
  return { porColumna, ambigua: parsed.ambigua, original: parsed.original };
}

/** Una celda despivotada de la matriz: la columna, su cantidad y la etiqueta de su talla. */
export interface CeldaDespivotada {
  columna: number;
  cantidad: number;
  /** Etiqueta de talla de esa columna (de la cadena `Tallas`), o `null` si la columna no tenía. */
  etiqueta: string | null;
}

/**
 * Despivota las columnas `T1..T8` de UN renglón de `OrdenesDet` (las cantidades) contra el
 * mapa de columnas→etiqueta de la orden padre. Devuelve SOLO las celdas con cantidad >0
 * (matriz dispersa). Cada celda trae la etiqueta de su columna (o `null` si la cadena `Tallas`
 * no tenía etiqueta para esa columna — caso a reportar: hay cantidad sin etiqueta).
 *
 * @param cantidades arreglo de 8 cantidades (T1..T8); elementos faltantes se tratan como 0.
 * @param porColumna mapa columna→etiqueta de {@link mapaColumnasTalla}.
 */
export function despivotarRenglon(
  cantidades: (number | null)[],
  porColumna: Map<number, string>,
): CeldaDespivotada[] {
  const celdas: CeldaDespivotada[] = [];
  for (let col = 1; col <= 8; col += 1) {
    const cantidad = cantidades[col - 1] ?? 0;
    if (cantidad > 0) {
      celdas.push({ columna: col, cantidad, etiqueta: porColumna.get(col) ?? null });
    }
  }
  return celdas;
}

/** Rango Unicode de marcas diacríticas combinantes (acentos…) tras `normalize('NFD')`. */
const REGEX_DIACRITICOS = /[̀-ͯ]/g;

/**
 * Clave NORMALIZADA de un color de orden (texto libre del viejo) para casarlo con el catálogo
 * `Color`: sin acentos, minúsculas, espacios colapsados, recortado. Es SOLO para comparar (no
 * se persiste): el nombre canónico del catálogo lo decidió el ETL de colores (F1-E6). Maneja
 * el encoding CP850 ya decodificado (la `ñ`/acentos ya llegan como Unicode correcto).
 *
 * @example normalizarClaveColor("  Algodón  Café ") === "algodon cafe"
 */
export function normalizarClaveColor(crudo: string | null | undefined): string {
  if (crudo === null || crudo === undefined) {
    return '';
  }
  return crudo
    .normalize('NFD')
    .replace(REGEX_DIACRITICOS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
