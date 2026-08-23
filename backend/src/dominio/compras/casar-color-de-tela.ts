/**
 * ⭐ **CÓMO SE PROPONE EL COLOR DE TELA DE UN COLOR DE PRENDA** (V1-E3u, §Post-F9.89) — función
 * PURA, sin BD.
 *
 * El sistema tiene dos nociones de color que nunca se tocaron: el de la **prenda** (`Color`, el de
 * la matriz color×talla de la orden, con su pantone en `OrdenLinea.pantone`) y el de la **tela**
 * (`TelaColor`, nombre libre del proveedor con su propio pantone y su precio). Al comprar hay que
 * decir cuál va con cuál. Daniel pidió que **el sistema proponga y la persona capture**, así que
 * esto propone — y **nunca guarda**: el amarre sólo existe cuando alguien lo confirma
 * (`OrdenTelaColor`).
 *
 * ⚠️ **Por qué es un módulo aparte y no vive en la cascada de precios.** `resolverPrecioColorReferencia`
 * (`costos/resolucion-precios.ts`) ya casa color de prenda con color de tela por liga y por nombre,
 * y esta función usa esas MISMAS dos reglas para las dos primeras posiciones. Pero le agrega dos
 * (pantone y "no hay ambigüedad posible") que **no se le pueden meter a la cascada de precios sin
 * mover números que nadie pidió mover**: el precosteo lleva meses cotizando con esa cascada, y
 * §Post-F9.89 vino a abrir la compra por color, no a re-costear lo ya costeado. Una regla nueva
 * para proponer es barata (la persona la ve y la confirma); una regla nueva para valuar es un
 * cambio silencioso de precios.
 *
 * ⚠️ **El orden de las reglas es de MÁS a MENOS evidencia**, y ninguna adivina de más:
 *  1. `liga-catalogo` — la tela YA tiene ese color de prenda amarrado (`TelaColor.idColor`, la liga
 *     legada de F1-E6). Es un dato capturado, no una coincidencia.
 *  2. `mismo-pantone` — el pantone es un CÓDIGO: dos pantones iguales son el mismo color, dicho por
 *     el cliente y por el proveedor. Vale más que un nombre porque no depende de cómo se escriba.
 *  3. `mismo-nombre` — "Negro" con "NEGRO" (insensible a mayúsculas y espacios).
 *  4. `unico-color` — **sólo cuando no hay ambigüedad posible**: la orden es de UN color y la tela
 *     tiene UN color dado de alta. Con dos colores de orden y uno de tela NO se propone: proponer
 *     el mismo para los dos sería inventar que la tela se compra en un solo tono, que es justo el
 *     error que esta etapa vino a quitar.
 *  5. `sin-propuesta` — y se dice. Nada se rellena a ciegas (D3).
 */
import type { OrigenPropuestaColor } from '../../contrato/index.js';

/** Un color de la TELA, en la forma mínima que hace falta para casarlo. */
export interface ColorDeTelaCandidato {
  /** `TelaColor.id`. */
  id: number;
  /** `TelaColor.nombre` (nombre libre del color de esa tela). */
  nombre: string;
  /** `TelaColor.pantone`, o null. */
  pantone: string | null;
  /** LEGACY `TelaColor.idColor`: liga al catálogo de PRENDA en las filas migradas; null en las nuevas. */
  idColor: number | null;
}

/** El color de PRENDA en contexto (el de la matriz de la orden) con su pantone de la OP. */
export interface ColorDePrendaContexto {
  idColor: number;
  nombre: string;
  /** `OrdenLinea.pantone` — el pantone que la OP capturó para ese color, o null. */
  pantone: string | null;
}

/** Lo que la propuesta devuelve: el color de tela elegido (o ninguno) y POR QUÉ. */
export interface PropuestaColorDeTela {
  idTelaColor: number | null;
  nombre: string | null;
  origen: OrigenPropuestaColor;
}

/** Texto comparable: sin espacios de sobra y en minúsculas. Cadena vacía = no comparable. */
function clave(valor: string | null): string {
  return (valor ?? '').trim().toLowerCase();
}

/**
 * Propone el color de tela que le toca a un color de prenda.
 *
 * @param coloresTela colores dados de alta para ESA tela (`TelaColor` de la tela del renglón).
 * @param contexto color de prenda de la matriz de la orden, con su pantone.
 * @param coloresDeLaOrden cuántos colores DISTINTOS tiene la matriz de la orden. Sólo lo usa la
 *   regla `unico-color`, y es la razón de que exista el parámetro: sin él, una orden de tres
 *   colores contra una tela de un solo color propondría ese mismo color tres veces.
 */
export function proponerColorDeTela(
  coloresTela: readonly ColorDeTelaCandidato[],
  contexto: ColorDePrendaContexto,
  coloresDeLaOrden: number,
): PropuestaColorDeTela {
  const sinPropuesta: PropuestaColorDeTela = {
    idTelaColor: null,
    nombre: null,
    origen: 'sin-propuesta',
  };
  if (coloresTela.length === 0) {
    return sinPropuesta;
  }

  // 1. Liga legada al catálogo de prenda (dato capturado, no coincidencia).
  const porLiga = coloresTela.find((c) => c.idColor !== null && c.idColor === contexto.idColor);
  if (porLiga !== undefined) {
    return { idTelaColor: porLiga.id, nombre: porLiga.nombre, origen: 'liga-catalogo' };
  }

  // 2. Mismo PANTONE. Sólo si la OP capturó uno: sin pantone no hay nada que comparar, y comparar
  //    dos vacíos casaría cualquier cosa con cualquier cosa.
  const pantoneOp = clave(contexto.pantone);
  if (pantoneOp !== '') {
    const porPantone = coloresTela.find((c) => clave(c.pantone) === pantoneOp);
    if (porPantone !== undefined) {
      return { idTelaColor: porPantone.id, nombre: porPantone.nombre, origen: 'mismo-pantone' };
    }
  }

  // 3. Mismo NOMBRE (insensible a mayúsculas y espacios).
  const nombreOp = clave(contexto.nombre);
  if (nombreOp !== '') {
    const porNombre = coloresTela.find((c) => clave(c.nombre) === nombreOp);
    if (porNombre !== undefined) {
      return { idTelaColor: porNombre.id, nombre: porNombre.nombre, origen: 'mismo-nombre' };
    }
  }

  // 4. Sin ambigüedad posible: UN color en la orden y UN color en la tela.
  if (coloresDeLaOrden === 1 && coloresTela.length === 1) {
    const unico = coloresTela[0] as ColorDeTelaCandidato;
    return { idTelaColor: unico.id, nombre: unico.nombre, origen: 'unico-color' };
  }

  return sinPropuesta;
}
