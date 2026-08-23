import { z } from 'zod';

/**
 * Esquema y constantes de captura del formulario del ARTE del modelo (V1-E3d). Viven en el
 * módulo (no en `api/esquemas.ts` compartido) para que esta pieza sea autónoma.
 *
 * Refleja las reglas de captura del backend (`backend/src/contrato/esquemas/arte.ts`),
 * pero es SOLO para la experiencia de usuario: el servidor SIEMPRE re-valida y es la
 * autoridad (A1). Los numericos opcionales se capturan como texto (vacio = sin valor) y
 * se convierten a numero al ARMAR EL CUERPO del API (mismo patron `numeroOpcional` que
 * usa `api/esquemas.ts`).
 */

// V1-E3f (§Post-F9.58): los tipos de arte YA NO son una lista fija en el programa — salen del
// catálogo administrable `TipoProceso` marcado con `esArte` (`api/tipos-proceso.ts`,
// `useTiposArte`). Por eso aquí ya no hay `TIPOS_ARTE` ni sus etiquetas.

/**
 * Helper de captura para un numero OPCIONAL en un `<input type="number">`: el valor es
 * texto (vacio = sin valor). Valida que, si hay algo, sea un numero dentro de
 * `[min, max]`. Entrada y salida son `string`; la conversion a `number` la hace
 * `numeroOpcionalACuerpo`. Replica el patron de `api/esquemas.ts`.
 */
function numeroOpcional(opciones: {
  min?: number;
  max?: number;
  mensajeNoNumero: string;
  mensajeMin?: string;
  mensajeMax?: string;
}): z.ZodString {
  let esquema = z
    .string()
    .refine((valor) => valor.trim() === '' || Number.isFinite(Number(valor)), {
      error: opciones.mensajeNoNumero,
    });
  if (opciones.min !== undefined) {
    const min = opciones.min;
    esquema = esquema.refine((valor) => valor.trim() === '' || Number(valor) >= min, {
      error: opciones.mensajeMin ?? opciones.mensajeNoNumero,
    });
  }
  if (opciones.max !== undefined) {
    const max = opciones.max;
    esquema = esquema.refine((valor) => valor.trim() === '' || Number(valor) <= max, {
      error: opciones.mensajeMax ?? opciones.mensajeNoNumero,
    });
  }
  return esquema;
}

/** Convierte el texto de un campo numerico opcional a `number`, o `undefined` si esta vacio. */
export function numeroOpcionalACuerpo(valor: string): number | undefined {
  const texto = valor.trim();
  return texto === '' ? undefined : Number(texto);
}

/**
 * Captura del formulario del ARTE (alta y edición comparten forma). V1-E3f (§Post-F9.52):
 * la `descripcion` es el campo VISIBLE y obligatorio (el `nombre` se retiró — Daniel: *"Es
 * completamente irrelevante el nombre del estampado"*), `posicion` es texto LIBRE, el tipo es un
 * id del catálogo único y `puntadas`/`precio`/`idProveedor` se capturan como texto (vacío = sin
 * valor). Las FOTOS no van en el schema: se suben/quitan aparte (presigned). Validación solo de
 * UX: el backend re-valida (A1).
 */
export const esquemaArteFormulario = z.object({
  descripcion: z
    .string({ error: 'La descripción es obligatoria' })
    .trim()
    .min(1, { error: 'La descripción es obligatoria' })
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' }),
  /** Dónde va el arte en la prenda: frente, espalda, manga… TEXTO LIBRE (§Post-F9.52 punto 2). */
  posicion: z
    .string()
    .trim()
    .max(100, { error: 'La posición no puede tener más de 100 caracteres' }),
  /** Id del tipo de arte en el catálogo único. Vacío = no se eligió (obligatorio). */
  idTipoArte: z
    .string()
    .refine((valor) => valor.trim() !== '', { error: 'El tipo de arte es obligatorio' }),
  puntadas: numeroOpcional({
    min: 0,
    max: 1_000_000,
    mensajeNoNumero: 'Las puntadas deben ser un número',
    mensajeMin: 'Las puntadas no pueden ser negativas',
    mensajeMax: 'Las puntadas no pueden ser más de 1,000,000',
  }).describe('Número de puntadas (vacío = sin valor).'),
  precio: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'El precio debe ser un número',
    mensajeMin: 'El precio no puede ser negativo',
  }).describe('Precio del arte — el que viaja a la OP (vacío = sin valor).'),
  /** Proveedor que hace el arte (NUEVO en V1-E3d). Vacío = sin proveedor. */
  idProveedor: z.string(),
});

/** Datos del formulario del arte. */
export type DatosArteFormulario = z.infer<typeof esquemaArteFormulario>;
