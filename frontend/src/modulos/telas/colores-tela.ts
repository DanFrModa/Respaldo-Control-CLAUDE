import type { TelaColorEntrada } from '@/api/telas';

/**
 * Helpers PUROS del grid de colores de una tela (F1-E3; reestructura A1 §Post-F9.11:
 * los colores son HIJOS de la tela — nombre LIBRE + pantone + dos precios; el catálogo
 * global `Color` es solo el color de la PRENDA y aquí no participa). Viven aparte del
 * componente `EditorColoresTela` (regla fast-refresh: un archivo de componente solo
 * exporta componentes) — mismo criterio que `@/lib/tono` frente a `visuales.tsx`.
 *
 * Convierten entre el cuerpo del API
 * (`colores: { nombre, precio?, precioComplemento?, pantone? }[]`) y los RENGLONES de
 * captura (los precios como TEXTO de un `<input type="number">`, '' = sin precio; el
 * pantone como texto libre, '' = sin pantone).
 */

/** Un renglon del grid tal como lo edita la UI (precios/pantone como TEXTO, '' = vacio). */
export interface RenglonColor {
  /**
   * Id de la FILA existente (R3-1): viaja al API para que RENOMBRAR el color sea un update
   * en sitio que conserva su liga legacy/pantone/auditoria. Las filas nuevas van sin id.
   */
  id?: number | undefined;
  /** Nombre LIBRE del color de ESTA tela (su identidad; unico por tela). */
  nombre: string;
  /** Precio del CUERPO como texto del `<input>` ('' = sin precio). */
  precioTexto: string;
  /** Precio del COMPLEMENTO (cardigan) como texto ('' = sin precio). */
  precioComplementoTexto: string;
  /** Codigo PANTONE como texto libre ('' = sin pantone). */
  pantoneTexto: string;
}

/** Llave de comparacion del nombre de un color (unicidad POR tela, insensible). */
export function claveNombreColor(nombre: string): string {
  return nombre.trim().toLowerCase();
}

/** Convierte el cuerpo del API (numeros/null) a renglones de captura (texto). */
export function aRenglones(
  colores: readonly {
    id?: number;
    nombre: string;
    precio?: number | null;
    precioComplemento?: number | null;
    pantone?: string | null;
  }[],
): RenglonColor[] {
  return colores.map((c) => ({
    ...(c.id === undefined ? {} : { id: c.id }),
    nombre: c.nombre,
    precioTexto: c.precio === null || c.precio === undefined ? '' : String(c.precio),
    precioComplementoTexto:
      c.precioComplemento === null || c.precioComplemento === undefined
        ? ''
        : String(c.precioComplemento),
    pantoneTexto: c.pantone ?? '',
  }));
}

/**
 * Convierte los renglones de captura al cuerpo del API (texto -> number|undefined; el
 * pantone vacio se OMITE). Si la tela NO lleva complemento, el precio del complemento se
 * omite siempre (la UI lo esconde y el backend lo RECHAZA, H2 — el dato tampoco debe
 * viajar por accidente).
 */
export function aColoresCuerpo(
  renglones: readonly RenglonColor[],
  opciones: { llevaComplemento?: boolean } = {},
): TelaColorEntrada[] {
  const llevaComplemento = opciones.llevaComplemento ?? false;
  return renglones.map((r) => {
    const precio = r.precioTexto.trim();
    const complemento = r.precioComplementoTexto.trim();
    const pantone = r.pantoneTexto.trim();
    return {
      ...(r.id === undefined ? {} : { id: r.id }),
      nombre: r.nombre.trim(),
      ...(precio === '' ? {} : { precio: Number(precio) }),
      ...(llevaComplemento && complemento !== '' ? { precioComplemento: Number(complemento) } : {}),
      ...(pantone === '' ? {} : { pantone }),
    };
  });
}
