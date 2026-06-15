/**
 * Parser de la columna `Tallas` del sistema viejo (F1-E6, ETL — D4/A6).
 *
 * En el viejo, `Ordenes.Tallas` es una cadena de ANCHO FIJO de **2 caracteres por talla**
 * (NO separada por espacios). Lo confirma el form `TallasMeter` (VBA):
 *   `Tal1 = Mid(Cad, 1, 2)`, `Tal2 = Mid(Cad, 3, 2)`, … hasta `Tal8 = Mid(Cad, 15, 2)`.
 * Es decir, hasta 8 tallas, cada una en una ventana fija de 2 chars; las etiquetas de 1
 * carácter (G, M…) llevan un espacio de relleno ("G " ⇒ "G").
 *
 * Ejemplos reales (de `Ordenes.csv`):
 *   "XCCHM G XG" → ["XC","CH","M ","G ","XG"] → trim → ["XC","CH","M","G","XG"]
 *   "CHM G EX"   → ["CH","M ","G ","EX"]      → ["CH","M","G","EX"]
 *   "12141618"   → ["12","14","16","18"]
 *
 * Las cadenas que NO siguen el formato (longitud impar, separadores raros como `--`,
 * cadenas con un `\n`…) se DEVUELVEN marcadas como `rara` para el reporte de cuadre
 * (§7: las inconsistencias van a REPORTE, no se arreglan en silencio).
 */

/** Resultado de parsear una cadena de tallas: las etiquetas y si la cadena fue "rara". */
export interface TallasParseadas {
  /** Etiquetas de talla, en orden, ya recortadas y sin vacías. */
  etiquetas: string[];
  /** `true` si la cadena no encaja limpio en el formato de ancho fijo de 2 (va al reporte). */
  rara: boolean;
  /** La cadena original (para el reporte, si fue rara). */
  original: string;
}

/**
 * Parsea una cadena de tallas de ANCHO FIJO de 2 caracteres. Recorre la cadena en pasos de
 * 2, recorta cada par y descarta los vacíos. Marca `rara: true` cuando:
 *  • la cadena (sin espacios de relleno finales) tiene longitud impar, o
 *  • contiene separadores que delatan DOS curvas pegadas (`--`) o saltos de línea, o
 *  • queda vacía tras recortar.
 *
 * El llamador (loader de tallas/curvas) decide: las no-raras alimentan el catálogo `Talla`
 * y, si se pide, una `CurvaTalla`; las raras se listan al reporte para decisión.
 */
export function parsearTallasAnchoFijo(crudo: string): TallasParseadas {
  const original = crudo;

  // Señales de cadena rara que el ancho fijo NO sabe partir: dos curvas pegadas con "--",
  // o un salto de línea dentro de la celda.
  if (crudo.includes('--') || crudo.includes('\n') || crudo.includes('\r')) {
    return { etiquetas: [], rara: true, original };
  }

  // Se recorre la cadena COMPLETA en ventanas FIJAS de 2 (el relleno del viejo es a la
  // derecha con espacios: cada talla ocupó su par, p. ej. "G " ⇒ "G"). NO se recorta la cola
  // antes de partir (eso rompería el ancho fijo): se parte primero, se recorta cada par.
  if (crudo.trim() === '') {
    return { etiquetas: [], rara: true, original };
  }

  const etiquetas: string[] = [];
  let huboRara = false;
  for (let i = 0; i < crudo.length; i += 2) {
    const par = crudo.slice(i, i + 2);
    const etiqueta = par.trim();
    if (par.length < 2 && etiqueta !== '') {
      // Carácter suelto al final (longitud impar con contenido): no respeta el ancho fijo.
      huboRara = true;
      etiquetas.push(etiqueta);
      continue;
    }
    if (etiqueta !== '') {
      etiquetas.push(etiqueta);
    }
  }

  return { etiquetas, rara: huboRara || etiquetas.length === 0, original };
}
