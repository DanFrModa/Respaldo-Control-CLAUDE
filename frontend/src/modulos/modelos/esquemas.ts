import { z } from 'zod';

/**
 * Esquema y constantes de captura del Módulo 2 — Modelos (F1-E4). Viven en el módulo (no en
 * `api/esquemas.ts`) para que esta pieza sea autónoma. Refleja las reglas del backend
 * (`backend/src/contrato/esquemas/modelo.ts`) pero es SOLO UX: el servidor re-valida (A1).
 *
 * Los selectores de temporada/curva/género se capturan como TEXTO (el `<select>` entrega
 * string; '' = sin seleccionar) y se convierten a number/null al armar el cuerpo. La maquila
 * base es un número opcional capturado como texto (mismo patrón `numeroOpcional` que avíos).
 */

/** Tipos de foto del modelo (espejo del backend). */
export const TIPOS_FOTO_MODELO = ['FRENTE', 'ESPALDA', 'OTRO'] as const;
/** Clave de tipo de foto de modelo. */
export type TipoFotoModeloClave = (typeof TIPOS_FOTO_MODELO)[number];
/** Etiquetas para UI de cada tipo de foto. */
export const ETIQUETAS_TIPO_FOTO_MODELO: Record<TipoFotoModeloClave, string> = {
  FRENTE: 'Frente',
  ESPALDA: 'Espalda',
  OTRO: 'Otra',
};

/** Convierte el texto de un campo numérico opcional a `number`, o `undefined` si está vacío. */
export function numeroOpcionalACuerpo(valor: string): number | undefined {
  const texto = valor.trim();
  return texto === '' ? undefined : Number(texto);
}

/** Convierte el id de un `<select>` (texto) a number, o `null` si está vacío ('' = sin elegir). */
export function idSelectorACuerpo(valor: string): number | null {
  const texto = valor.trim();
  return texto === '' ? null : Number(texto);
}

/**
 * Captura del formulario de modelo (alta y edición comparten forma). El `codigo` es
 * obligatorio; `descripcion` es texto opcional; `maquilaBase` se captura como texto (vacío =
 * sin valor); temporada/curva/género se eligen de selectores (vacío = sin asignar). El BOM y
 * las fotos NO van en este schema (se gestionan aparte). Validación solo de UX (A1).
 */
export const esquemaModeloFormulario = z.object({
  codigo: z
    .string({ error: 'El código es obligatorio' })
    .trim()
    .min(1, { error: 'El código es obligatorio' })
    .max(50, { error: 'El código no puede tener más de 50 caracteres' }),
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' }),
  /**
   * COMPOSICIÓN textil (Daniel 24-jul-2026): se captura AQUÍ, en el desarrollo del modelo, y toda
   * orden de este modelo la hereda sola. Vacío = sin capturar.
   */
  composicion: z
    .string()
    .trim()
    .max(2000, { error: 'La composición no puede tener más de 2000 caracteres' }),
  maquilaBase: z
    .string()
    .refine((v) => v.trim() === '' || Number.isFinite(Number(v)), {
      error: 'La maquila base debe ser un número',
    })
    .refine((v) => v.trim() === '' || Number(v) >= 0, {
      error: 'La maquila base no puede ser negativa',
    })
    .describe('Costo de maquila base (vacío = sin valor).'),
  /** Corte por prenda (R5/B8): costo fijo separado de la maquila, sin proveedor. */
  corteBase: z
    .string()
    .refine((v) => v.trim() === '' || Number.isFinite(Number(v)), {
      error: 'El corte debe ser un número',
    })
    .refine((v) => v.trim() === '' || Number(v) >= 0, {
      error: 'El corte no puede ser negativo',
    })
    .describe('Costo de corte por prenda (vacío = sin valor).'),
  /** # de operaciones de costura (R5/B7): deriva la dificultad → días de costura del CPM. */
  numOperaciones: z
    .string()
    .refine((v) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 0), {
      error: 'El # de operaciones debe ser un entero ≥ 0',
    })
    .describe('# de operaciones de costura (vacío = sin capturar).'),
  /** Secuencia de estampado respecto a la costura (R5/B10). */
  secuenciaEstampado: z.enum(['antes', 'despues', 'flexible']),
  /** ¿La prenda lleva arte? Default `true` (decisión de Daniel 26-jul-2026). */
  llevaArte: z.boolean(),
  // Selectores: id como texto ('' = sin asignar).
  idTemporada: z.string(),
  idCurvaTalla: z.string(),
  idGenero: z.string(),
  /** Tipo de producto (F6-E1, opcional). */
  idTipoProducto: z.string(),
  /** Maquilero (costura) cotizado (R5/B9), selector de proveedores ('' = sin definir). */
  idMaquileroCotizado: z.string(),
});

/** Datos del formulario de modelo. */
export type DatosModeloFormulario = z.infer<typeof esquemaModeloFormulario>;
