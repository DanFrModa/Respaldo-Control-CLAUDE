import type { TelaColorEntrada } from '@/api/telas';

/**
 * Helpers PUROS del grid de colores de una tela (F1-E3). Viven aparte del componente
 * `EditorColoresTela` (regla fast-refresh: un archivo de componente solo exporta
 * componentes) — mismo criterio que `@/lib/tono` frente a `visuales.tsx`.
 *
 * Convierten entre el cuerpo del API (`colores: { idColor, precio? }[]`) y los RENGLONES
 * de captura (precio como TEXTO de un `<input type="number">`, '' = sin precio).
 */

/** Un renglon del grid tal como lo edita la UI: idColor + precio como TEXTO (vacio = sin precio). */
export interface RenglonColor {
  idColor: number;
  /** Precio como texto del `<input>` ('' = sin precio). Se convierte a number|undefined al enviar. */
  precioTexto: string;
}

/** Convierte el cuerpo del API (precio: number|null|undefined) a renglones de captura (precio texto). */
export function aRenglones(
  colores: readonly { idColor: number; precio?: number | null }[],
): RenglonColor[] {
  return colores.map((c) => ({
    idColor: c.idColor,
    precioTexto: c.precio === null || c.precio === undefined ? '' : String(c.precio),
  }));
}

/** Convierte los renglones de captura al cuerpo del API (precio texto -> number|undefined). */
export function aColoresCuerpo(renglones: readonly RenglonColor[]): TelaColorEntrada[] {
  return renglones.map((r) => {
    const texto = r.precioTexto.trim();
    return texto === '' ? { idColor: r.idColor } : { idColor: r.idColor, precio: Number(texto) };
  });
}
