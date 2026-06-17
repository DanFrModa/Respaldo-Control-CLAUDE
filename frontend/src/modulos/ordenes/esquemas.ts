import { z } from 'zod';

/**
 * Esquema Zod de CAPTURA del encabezado de una orden (F2-E3) — SOLO para la UX del formulario
 * (mensajes en español). Refleja las reglas del backend pero NO las reemplaza: el servidor re-valida
 * y es la autoridad (A1). Todos los campos del encabezado son opcionales (se asignan después del
 * alta); los selectores guardan el id como texto del `<select>` y las fechas como texto del input.
 */
export const esquemaOrdenFormulario = z.object({
  /** Id del maquilero (Proveedor); vacío = sin asignar. */
  idMaquilero: z.string(),
  /** Id de la etiqueta de marca; vacío = sin asignar. */
  idEtiquetaMarca: z.string(),
  /** Id de la tela; vacío = sin asignar. */
  idTela: z.string(),
  /** Fecha de la orden (YYYY-MM-DD) o vacío. */
  fecha: z.string(),
  /** Fecha de entrega comprometida (YYYY-MM-DD) o vacío. */
  fechaEntrega: z.string(),
  /** Composición textil (texto libre). */
  composicion: z.string(),
  /** La composición se capturó a mano. */
  compForzada: z.boolean(),
  /** Observaciones generales. */
  observaciones: z.string(),
  /** Observaciones de maquila. */
  obsMaquila: z.string(),
  /** No costear esta orden. */
  noCostear: z.boolean(),
});

/** Datos de captura del encabezado de la orden. */
export type DatosOrdenFormulario = z.infer<typeof esquemaOrdenFormulario>;

/** Encabezado vacío (valores por defecto del formulario). */
export const ENCABEZADO_VACIO: DatosOrdenFormulario = {
  idMaquilero: '',
  idEtiquetaMarca: '',
  idTela: '',
  fecha: '',
  fechaEntrega: '',
  composicion: '',
  compForzada: false,
  observaciones: '',
  obsMaquila: '',
  noCostear: false,
};

/**
 * Convierte el texto de un selector de id a `number | null` (vacío → null, para PATCH que vacía el
 * dato). El backend re-valida que el id exista y aplique.
 */
export function idACuerpo(valor: string): number | null {
  const limpio = valor.trim();
  return limpio.length > 0 ? Number(limpio) : null;
}

/** Convierte el texto de un campo de fecha a `YYYY-MM-DD` o `null` (vacío = vaciar en PATCH). */
export function fechaACuerpo(valor: string): string | null {
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : null;
}

/** Convierte un texto opcional a `string | null` (vacío = null, para vaciar el dato en PATCH). */
export function textoACuerpo(valor: string): string | null {
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : null;
}
