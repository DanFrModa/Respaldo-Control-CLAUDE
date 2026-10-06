/**
 * ⭐ FILA 0.221 — EL ENLACE AL KARDEX DE UN AVÍO (Daniel: *«Debería haber un botón para ver los
 * movimientos de cada avío»*). Vive aparte para que la pantalla que ENLAZA (existencias de avíos) y
 * la que LEE el enlace (kardex de materiales) compartan los MISMOS nombres de parámetro: si uno los
 * cambia y el otro no, el botón abriría el kardex vacío sin que nada truene.
 *
 * El kardex es UNA sola pantalla de movimientos; el botón no abre otra, abre ésa con el avío y el
 * almacén ya elegidos. Van en la URL (no en `state`) para que el enlace se pueda recargar, guardar o
 * mandar a alguien.
 */

/** Ruta de la pantalla del kardex de materiales (la de `App.tsx`). */
export const RUTA_KARDEX_MATERIALES = '/inventarios/materiales/kardex';

/** Nombres de los parámetros de la URL del kardex de materiales. */
export const PARAM_KARDEX = {
  /** Pestaña: `avio` o `tela` (ausente = telas, la de siempre). */
  material: 'material',
  idAvio: 'idAvio',
  idAlmacen: 'idAlmacen',
} as const;

/** Lee un id positivo de la URL; cualquier otra cosa (vacío, texto, 0, negativo) = sin filtro. */
export function idDeParametro(valor: string | null): number | undefined {
  if (valor === null || !/^\d+$/.test(valor)) return undefined;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** URL del kardex de UN avío, filtrado al almacén del renglón desde el que se pidió. */
export function rutaKardexAvio(idAvio: number, idAlmacen?: number): string {
  const params = new URLSearchParams({ [PARAM_KARDEX.material]: 'avio' });
  params.set(PARAM_KARDEX.idAvio, String(idAvio));
  if (idAlmacen !== undefined) params.set(PARAM_KARDEX.idAlmacen, String(idAlmacen));
  return `${RUTA_KARDEX_MATERIALES}?${params.toString()}`;
}
